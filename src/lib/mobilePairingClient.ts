/**
 * Mobile / Browser Companion Pairing Client
 * Connects securely to a user-authorized MK AI Desktop Companion Relay using a
 * short-lived pairing code exchanged for a revocable, scoped device session token.
 * NEVER stores, requests, or handles MK_ENGINE_TOKEN.
 */

const PAIRING_STORAGE_KEY = 'mk_ai_desktop_pairing_v1';

export interface StoredDesktopPairing {
  relayUrl: string;
  deviceId: string;
  deviceName: string;
  pairingToken: string;
  pairedAt: string;
  expiresAt: string;
  scopes: string[];
}

export interface PairedDesktopReachability {
  paired: boolean;
  reachable: boolean;
  engineHealthy: boolean;
  engineVersion: string | null;
  hardwareSummary: string | null;
  cudaAvailable: boolean;
  deviceName: string | null;
  error?: string;
}

export function normalizeRelayUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Pairing endpoint must use http:// (LAN) or https://.');
  }
  return parsed.origin;
}

export function getStoredDesktopPairing(): StoredDesktopPairing | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PAIRING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDesktopPairing;
    if (!parsed.pairingToken || !parsed.relayUrl || Date.parse(parsed.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(PAIRING_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredDesktopPairing(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PAIRING_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export async function pairWithDesktopCompanion(params: {
  relayUrl: string;
  code: string;
  deviceName?: string;
}): Promise<StoredDesktopPairing> {
  const origin = normalizeRelayUrl(params.relayUrl);
  const res = await fetch(`${origin}/pair/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: params.code.trim(),
      deviceName:
        params.deviceName?.trim() ||
        (typeof navigator !== 'undefined' ? navigator.platform || 'MK Mobile PWA' : 'MK Mobile PWA'),
    }),
    signal: AbortSignal.timeout(6000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    deviceId?: string;
    deviceName?: string;
    pairingToken?: string;
    expiresAt?: string;
    scopes?: string[];
    error?: string;
  };
  if (!res.ok || !data.pairingToken || !data.deviceId) {
    throw new Error(data.error || `Pairing failed with HTTP ${res.status}`);
  }

  const stored: StoredDesktopPairing = {
    relayUrl: origin,
    deviceId: data.deviceId,
    deviceName: data.deviceName || 'MK Mobile PWA',
    pairingToken: data.pairingToken,
    pairedAt: new Date().toISOString(),
    expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(stored));
  }
  return stored;
}

export async function checkPairedDesktopReachability(): Promise<PairedDesktopReachability> {
  const pairing = getStoredDesktopPairing();
  if (!pairing) {
    return {
      paired: false,
      reachable: false,
      engineHealthy: false,
      engineVersion: null,
      hardwareSummary: null,
      cudaAvailable: false,
      deviceName: null,
    };
  }

  try {
    const res = await fetch(`${pairing.relayUrl}/pair/status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${pairing.pairingToken}` },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401) {
      clearStoredDesktopPairing();
      return {
        paired: false,
        reachable: true,
        engineHealthy: false,
        engineVersion: null,
        hardwareSummary: null,
        cudaAvailable: false,
        deviceName: null,
        error: 'Desktop pairing access was revoked or expired.',
      };
    }
    if (!res.ok) {
      return {
        paired: true,
        reachable: false,
        engineHealthy: false,
        engineVersion: null,
        hardwareSummary: null,
        cudaAvailable: false,
        deviceName: pairing.deviceName,
        error: `Desktop responded with HTTP ${res.status}. Falling back to Cloud Python.`,
      };
    }

    const data = (await res.json()) as {
      engineHealthy?: boolean;
      engineVersion?: string | null;
      hardware?: {
        cpuModel?: string;
        nvidiaGpuName?: string | null;
        pytorchCudaAvailable?: boolean;
      };
    };
    const hw = data.hardware;
    const hwSummary = hw
      ? hw.nvidiaGpuName && hw.pytorchCudaAvailable
        ? `${hw.nvidiaGpuName} (CUDA)`
        : hw.cpuModel || 'Desktop CPU'
      : null;

    return {
      paired: true,
      reachable: true,
      engineHealthy: Boolean(data.engineHealthy),
      engineVersion: data.engineVersion ?? null,
      hardwareSummary: hwSummary,
      cudaAvailable: Boolean(hw?.pytorchCudaAvailable),
      deviceName: pairing.deviceName,
    };
  } catch {
    return {
      paired: true,
      reachable: false,
      engineHealthy: false,
      engineVersion: null,
      hardwareSummary: null,
      cudaAvailable: false,
      deviceName: pairing.deviceName,
      error: 'Paired Desktop is offline or unreachable from this network. Cloud Python fallback available.',
    };
  }
}

export async function dispatchPairedDesktopTrainingJob(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const pairing = getStoredDesktopPairing();
  if (!pairing) throw new Error('Desktop companion is not paired.');
  const res = await fetch(`${pairing.relayUrl}/pair/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pairing.pairingToken}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401) clearStoredDesktopPairing();
    throw new Error(String(data.error || data.detail || `HTTP ${res.status}`));
  }
  return data;
}

export async function fetchPairedDesktopTrainingJob(
  jobId: string
): Promise<Record<string, unknown>> {
  const pairing = getStoredDesktopPairing();
  if (!pairing) throw new Error('Desktop companion is not paired.');
  const res = await fetch(`${pairing.relayUrl}/pair/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${pairing.pairingToken}` },
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401) clearStoredDesktopPairing();
    throw new Error(String(data.error || data.detail || `HTTP ${res.status}`));
  }
  return data;
}

export async function controlPairedDesktopTrainingJob(
  jobId: string,
  action: 'pause' | 'resume' | 'cancel'
): Promise<Record<string, unknown>> {
  const pairing = getStoredDesktopPairing();
  if (!pairing) throw new Error('Desktop companion is not paired.');
  const res = await fetch(
    `${pairing.relayUrl}/pair/jobs/${encodeURIComponent(jobId)}/${action}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${pairing.pairingToken}` },
      signal: AbortSignal.timeout(5000),
    }
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401) clearStoredDesktopPairing();
    throw new Error(String(data.error || data.detail || `HTTP ${res.status}`));
  }
  return data;
}
