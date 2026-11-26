import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {
  PairedDeviceSummary,
  PairingCodeChallenge,
  PairingRelayStatus,
} from '../../src/types/desktop.ts';

interface StoredPairedDeviceRecord extends PairedDeviceSummary {
  tokenHash: string;
}

interface PairingCodeInternal {
  code: string;
  createdAtMs: number;
  expiresAtMs: number;
  failedAttempts: number;
  used: boolean;
}

export interface PairingRelayHandlerContext {
  getEngineSummary: () => Promise<Record<string, unknown>>;
  proxyEngineJson: (
    apiPath: string,
    opts?: { method?: 'GET' | 'POST'; body?: unknown }
  ) => Promise<Record<string, unknown>>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SAFE_JOB_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function generateShortCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

function listLanIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}

export class DesktopPairingManager {
  private securityDir: string;
  private storePath: string;
  private activeChallenge: PairingCodeInternal | null = null;
  private devices: StoredPairedDeviceRecord[] = [];
  private relayServer: http.Server | null = null;
  private relayPort: number | null = null;
  private relayEnabled = false;
  private relayContext: PairingRelayHandlerContext | null = null;

  constructor(params: { userDataRoot: string; relayContext?: PairingRelayHandlerContext }) {
    this.securityDir = path.join(path.resolve(params.userDataRoot), 'security');
    this.storePath = path.join(this.securityDir, 'paired-devices.json');
    this.relayContext = params.relayContext ?? null;
    this.loadDevices();
  }

  private ensureSecurityDir(): void {
    fs.mkdirSync(this.securityDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.securityDir, 0o700);
    } catch {
      // Windows NTFS ACLs ignore POSIX chmod
    }
  }

  private loadDevices(): void {
    if (!fs.existsSync(this.storePath)) {
      this.devices = [];
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as StoredPairedDeviceRecord[];
      this.devices = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.devices = [];
    }
  }

  private persistDevices(): void {
    this.ensureSecurityDir();
    fs.writeFileSync(this.storePath, JSON.stringify(this.devices, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  createPairingCode(ttlMs = 5 * 60 * 1000): PairingCodeChallenge {
    const now = Date.now();
    const code = generateShortCode();
    this.activeChallenge = {
      code,
      createdAtMs: now,
      expiresAtMs: now + Math.max(30_000, Math.min(15 * 60_000, ttlMs)),
      failedAttempts: 0,
      used: false,
    };
    return this.getActiveChallengeSummary()!;
  }

  private getActiveChallengeSummary(): PairingCodeChallenge | null {
    if (!this.activeChallenge) return null;
    if (this.activeChallenge.used || Date.now() >= this.activeChallenge.expiresAtMs) {
      this.activeChallenge = null;
      return null;
    }
    const lanUrls = this.getLanUrls();
    return {
      code: this.activeChallenge.code,
      createdAt: new Date(this.activeChallenge.createdAtMs).toISOString(),
      expiresAt: new Date(this.activeChallenge.expiresAtMs).toISOString(),
      relayUrl: lanUrls[0] ?? (this.relayPort ? `http://127.0.0.1:${this.relayPort}` : null),
      relayEnabled: this.relayEnabled,
    };
  }

  exchangePairingCode(params: {
    code: string;
    deviceName: string;
  }): {
    deviceId: string;
    deviceName: string;
    pairingToken: string;
    expiresAt: string;
    scopes: string[];
  } {
    const ch = this.activeChallenge;
    if (!ch || ch.used || Date.now() >= ch.expiresAtMs) {
      this.activeChallenge = null;
      throw new Error('Pairing code is expired, missing, or already used. Authorize a new code on Desktop.');
    }

    const normalizedInput = params.code.trim().toUpperCase();
    const normalizedExpected = ch.code.toUpperCase();
    const a = Buffer.from(normalizedInput.padEnd(16, ' '), 'utf8');
    const b = Buffer.from(normalizedExpected.padEnd(16, ' '), 'utf8');
    const matches =
      normalizedInput.length === normalizedExpected.length && crypto.timingSafeEqual(a, b);

    if (!matches) {
      ch.failedAttempts += 1;
      if (ch.failedAttempts >= 5) {
        this.activeChallenge = null;
      }
      throw new Error('Invalid pairing code.');
    }

    // Single-use code invalidated immediately upon successful exchange
    ch.used = true;
    this.activeChallenge = null;

    // Mint an isolated, revocable device bearer credential (never equal to or derived from MK_ENGINE_TOKEN)
    const pairingToken = `mkpair_${crypto.randomBytes(32).toString('base64url')}`;
    const deviceId = `dev_${crypto.randomBytes(8).toString('hex')}`;
    const cleanName = params.deviceName.trim().slice(0, 64) || 'MK Mobile PWA';
    const pairedAt = new Date();
    const expiresAt = new Date(pairedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const scopes = ['read:status', 'read:jobs', 'dispatch:training', 'control:jobs'];

    const record: StoredPairedDeviceRecord = {
      deviceId,
      deviceName: cleanName,
      pairedAt: pairedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastSeenAt: pairedAt.toISOString(),
      revoked: false,
      scopes,
      tokenHash: sha256Hex(pairingToken),
    };

    this.devices = [record, ...this.devices].slice(0, 25);
    this.persistDevices();

    return {
      deviceId,
      deviceName: cleanName,
      pairingToken,
      expiresAt: record.expiresAt,
      scopes,
    };
  }

  verifyPairedToken(bearerToken: string): PairedDeviceSummary | null {
    const clean = bearerToken.trim();
    if (!clean.startsWith('mkpair_') || clean.length < 32) {
      return null;
    }
    const incomingHash = sha256Hex(clean);
    const now = Date.now();

    for (const dev of this.devices) {
      if (dev.revoked) continue;
      if (Date.parse(dev.expiresAt) <= now) continue;
      const a = Buffer.from(incomingHash, 'hex');
      const b = Buffer.from(dev.tokenHash, 'hex');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        dev.lastSeenAt = new Date().toISOString();
        this.persistDevices();
        return this.sanitizeDevice(dev);
      }
    }
    return null;
  }

  private sanitizeDevice(dev: StoredPairedDeviceRecord): PairedDeviceSummary {
    return {
      deviceId: dev.deviceId,
      deviceName: dev.deviceName,
      pairedAt: dev.pairedAt,
      expiresAt: dev.expiresAt,
      lastSeenAt: dev.lastSeenAt,
      revoked: dev.revoked,
      scopes: [...dev.scopes],
    };
  }

  listDevices(): PairedDeviceSummary[] {
    return this.devices.map((d) => this.sanitizeDevice(d));
  }

  revokeDevice(deviceId: string): PairingRelayStatus {
    let changed = false;
    this.devices = this.devices.map((d) => {
      if (d.deviceId === deviceId && !d.revoked) {
        changed = true;
        return { ...d, revoked: true };
      }
      return d;
    });
    if (changed) {
      this.persistDevices();
    }
    return this.getStatus();
  }

  getLanUrls(): string[] {
    if (!this.relayPort) return [];
    const ips = listLanIpv4Addresses();
    if (ips.length === 0) return [`http://127.0.0.1:${this.relayPort}`];
    return ips.map((ip) => `http://${ip}:${this.relayPort}`);
  }

  getStatus(): PairingRelayStatus {
    return {
      enabled: this.relayEnabled,
      listening: Boolean(this.relayServer && this.relayPort),
      port: this.relayPort,
      lanUrls: this.getLanUrls(),
      activeChallenge: this.getActiveChallengeSummary(),
      devices: this.listDevices(),
    };
  }

  async setRelayEnabled(enabled: boolean, preferredPort = 8788): Promise<PairingRelayStatus> {
    if (!enabled) {
      await this.stopRelay();
      return this.getStatus();
    }
    if (this.relayServer) {
      return this.getStatus();
    }
    await this.startRelay(preferredPort);
    return this.getStatus();
  }

  private async startRelay(preferredPort: number): Promise<void> {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= 1_048_576) {
          chunks.push(chunk);
        }
      });
      req.on('end', () => {
        void this.handleRelayRequest(req, res, Buffer.concat(chunks).toString('utf8'));
      });
    });

    const listenOnPort = (port: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });

    try {
      this.relayPort = await listenOnPort(preferredPort);
    } catch {
      this.relayPort = await listenOnPort(0);
    }
    this.relayServer = server;
    this.relayEnabled = true;
  }

  async stopRelay(): Promise<void> {
    this.relayEnabled = false;
    this.relayPort = null;
    if (!this.relayServer) return;
    const srv = this.relayServer;
    this.relayServer = null;
    srv.closeAllConnections?.();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }

  private async handleRelayRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    rawBody: string
  ): Promise<void> {
    const sendJson = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    const urlPath = (req.url || '/').split('?')[0];

    if (req.method === 'POST' && urlPath === '/pair/exchange') {
      try {
        const parsed = JSON.parse(rawBody || '{}') as { code?: unknown; deviceName?: unknown };
        if (typeof parsed.code !== 'string') {
          sendJson(400, { error: 'Pairing code is required.' });
          return;
        }
        const session = this.exchangePairingCode({
          code: parsed.code,
          deviceName: typeof parsed.deviceName === 'string' ? parsed.deviceName : 'MK Mobile PWA',
        });
        sendJson(200, session);
      } catch (err) {
        sendJson(401, { error: err instanceof Error ? err.message : 'Pairing exchange failed.' });
      }
      return;
    }

    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const device = this.verifyPairedToken(bearer);
    if (!device) {
      sendJson(401, { error: 'Missing, expired, or revoked pairing credential.' });
      return;
    }

    if (!this.relayContext) {
      sendJson(503, { error: 'Desktop engine bridge unavailable.' });
      return;
    }

    try {
      if (req.method === 'GET' && urlPath === '/pair/status') {
        const summary = await this.relayContext.getEngineSummary();
        sendJson(200, {
          paired: true,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          ...summary,
        });
        return;
      }

      if (req.method === 'GET' && urlPath === '/pair/capabilities') {
        const caps = await this.relayContext.proxyEngineJson('/capabilities');
        sendJson(200, caps);
        return;
      }

      if (req.method === 'POST' && urlPath === '/pair/jobs') {
        const payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
        const out = await this.relayContext.proxyEngineJson('/jobs/train', {
          method: 'POST',
          body: payload,
        });
        sendJson(200, out);
        return;
      }

      const jobMatch = urlPath.match(/^\/pair\/jobs\/([^/]+)(?:\/(pause|resume|cancel))?$/);
      if (jobMatch) {
        const jobId = decodeURIComponent(jobMatch[1]);
        const action = jobMatch[2];
        if (!SAFE_JOB_ID_RE.test(jobId)) {
          sendJson(400, { error: 'Invalid job ID.' });
          return;
        }
        if (req.method === 'GET' && !action) {
          const out = await this.relayContext.proxyEngineJson(`/jobs/${encodeURIComponent(jobId)}`);
          sendJson(200, out);
          return;
        }
        if (req.method === 'POST' && action) {
          const out = await this.relayContext.proxyEngineJson(
            `/jobs/${encodeURIComponent(jobId)}/${action}`,
            { method: 'POST' }
          );
          sendJson(200, out);
          return;
        }
      }

      sendJson(404, { error: 'Unknown paired companion endpoint.' });
    } catch (err) {
      sendJson(502, { error: err instanceof Error ? err.message : 'Desktop engine proxy failed.' });
    }
  }
}
