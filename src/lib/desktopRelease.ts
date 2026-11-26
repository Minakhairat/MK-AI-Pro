export interface DesktopInstallerAsset {
  name: string;
  sizeBytes: number;
  downloadUrl: string;
  sha256: string | null;
}

export interface DesktopReleaseInfo {
  repo: string;
  releasesPageUrl: string;
  apiUrl: string;
  available: boolean;
  status: 'loading' | 'available' | 'coming_soon';
  version: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  releaseNotes: string | null;
  supportedWindows: string;
  architecture: string;
  systemRequirements: string[];
  installStepsEn: string[];
  installStepsAr: string[];
  installerAsset: DesktopInstallerAsset | null;
  offlineAsset: DesktopInstallerAsset | null;
  checkedAt: string;
  statusReason: string | null;
}

const DEFAULT_GITHUB_REPO = 'mk-tech/MK-AI-Pro';
const SAFE_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export function resolveDesktopGitHubRepo(overrideRepo?: string): string {
  const envRepo =
    overrideRepo ??
    (typeof import.meta !== 'undefined'
      ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_GITHUB_REPO
      : undefined);
  const cleaned = envRepo?.trim() || '';
  return SAFE_REPO_RE.test(cleaned) ? cleaned : DEFAULT_GITHUB_REPO;
}

export function getDesktopReleasesUrl(repo = resolveDesktopGitHubRepo()): string {
  return `https://github.com/${repo}/releases/latest`;
}

export function isTrustedGitHubReleaseDownloadUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return (
      parsed.hostname === 'github.com' ||
      parsed.hostname === 'objects.githubusercontent.com' ||
      parsed.hostname === 'release-assets.githubusercontent.com'
    );
  } catch {
    return false;
  }
}

export function parseSha256SumsText(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match) {
      map[match[2].trim()] = match[1].toLowerCase();
    }
  }
  return map;
}

export function formatReleaseFileSize(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function buildEmptyDesktopReleaseInfo(
  repo = resolveDesktopGitHubRepo(),
  status: 'loading' | 'coming_soon' = 'coming_soon',
  statusReason: string | null = null
): DesktopReleaseInfo {
  return {
    repo,
    releasesPageUrl: getDesktopReleasesUrl(repo),
    apiUrl: `https://api.github.com/repos/${repo}/releases/latest`,
    available: false,
    status,
    version: null,
    releaseName: null,
    publishedAt: null,
    releaseNotes: null,
    supportedWindows: 'Windows 10 / Windows 11 (64-bit)',
    architecture: 'x64',
    systemRequirements: [
      'Windows 10 (64-bit) or Windows 11 (64-bit)',
      '8 GB RAM minimum (16 GB recommended)',
      '10 GB free SSD space for isolated Python runtime, PyTorch, and weights',
      'Optional NVIDIA GPU with CUDA 11.8+ driver for GPU acceleration',
    ],
    installStepsEn: [
      'Download MK-AI-Setup.exe and verify its SHA-256 checksum if desired.',
      'Run MK-AI-Setup.exe (no Python, Node.js, Git, or CUDA toolkit install needed).',
      'Launch MK AI Desktop — the 10-step wizard automatically configures Python, GPU/CPU wheels, and MK-AI-Data.',
    ],
    installStepsAr: [
      'نزّل ملف التثبيت MK-AI-Setup.exe وتحقق من بصمة SHA-256 عند الحاجة.',
      'شغّل MK-AI-Setup.exe مباشرة بدون تثبيت Python أو Node.js أو Git أو كتابة أي أوامر CMD.',
      'افتح MK AI Desktop وسيقوم المعالج تلقائياً بتجهيز بيئة بايثون واكتشاف كارت الشاشة ومجلدات MK-AI-Data.',
    ],
    installerAsset: null,
    offlineAsset: null,
    checkedAt: new Date().toISOString(),
    statusReason,
  };
}

interface GitHubReleaseAssetPayload {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
}

interface GitHubReleasePayload {
  draft?: unknown;
  prerelease?: unknown;
  tag_name?: unknown;
  name?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: unknown;
}

export function parseGitHubReleasePayload(
  payload: unknown,
  repo = resolveDesktopGitHubRepo(),
  shaMap: Record<string, string> = {}
): DesktopReleaseInfo {
  const base = buildEmptyDesktopReleaseInfo(repo, 'coming_soon');
  if (!payload || typeof payload !== 'object') {
    return { ...base, statusReason: 'No published GitHub Release metadata found.' };
  }

  const rel = payload as GitHubReleasePayload;
  if (rel.draft === true || !Array.isArray(rel.assets)) {
    return { ...base, statusReason: 'Latest release is a draft or has no assets.' };
  }

  const toInstallerAsset = (raw: GitHubReleaseAssetPayload): DesktopInstallerAsset | null => {
    if (
      typeof raw.name !== 'string' ||
      typeof raw.size !== 'number' ||
      typeof raw.browser_download_url !== 'string'
    ) {
      return null;
    }
    if (raw.size <= 0 || !isTrustedGitHubReleaseDownloadUrl(raw.browser_download_url)) {
      return null;
    }
    return {
      name: raw.name,
      sizeBytes: raw.size,
      downloadUrl: raw.browser_download_url,
      sha256: shaMap[raw.name] ?? null,
    };
  };

  const assets = rel.assets as GitHubReleaseAssetPayload[];
  const mainRaw =
    assets.find((a) => typeof a.name === 'string' && a.name === 'MK-AI-Setup.exe') ??
    assets.find(
      (a) =>
        typeof a.name === 'string' &&
        a.name.toLowerCase().endsWith('.exe') &&
        !a.name.toLowerCase().includes('offline')
    );

  const offlineRaw = assets.find(
    (a) => typeof a.name === 'string' && a.name === 'MK-AI-Offline-Setup.exe'
  );

  const installerAsset = mainRaw ? toInstallerAsset(mainRaw) : null;
  const offlineAsset = offlineRaw ? toInstallerAsset(offlineRaw) : null;

  if (!installerAsset) {
    return {
      ...base,
      version: typeof rel.tag_name === 'string' ? rel.tag_name : null,
      statusReason: 'Latest GitHub Release does not contain a validated MK-AI-Setup.exe asset yet.',
    };
  }

  return {
    ...base,
    available: true,
    status: 'available',
    version: typeof rel.tag_name === 'string' ? rel.tag_name : null,
    releaseName: typeof rel.name === 'string' ? rel.name : null,
    publishedAt: typeof rel.published_at === 'string' ? rel.published_at : null,
    releaseNotes: typeof rel.body === 'string' && rel.body.trim() ? rel.body.trim() : null,
    installerAsset,
    offlineAsset,
    statusReason: null,
  };
}

export async function fetchLatestDesktopRelease(
  repo = resolveDesktopGitHubRepo()
): Promise<DesktopReleaseInfo> {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return buildEmptyDesktopReleaseInfo(
        repo,
        'coming_soon',
        res.status === 404
          ? 'No public Windows installer release has been published yet.'
          : `GitHub Releases check returned HTTP ${res.status}.`
      );
    }

    const payload = (await res.json()) as GitHubReleasePayload;
    let shaMap: Record<string, string> = {};

    if (Array.isArray(payload.assets)) {
      const shaAsset = (payload.assets as GitHubReleaseAssetPayload[]).find(
        (a) =>
          a.name === 'SHA256SUMS.txt' &&
          typeof a.browser_download_url === 'string' &&
          isTrustedGitHubReleaseDownloadUrl(a.browser_download_url)
      );
      if (shaAsset && typeof shaAsset.browser_download_url === 'string') {
        try {
          const shaRes = await fetch(shaAsset.browser_download_url, {
            signal: AbortSignal.timeout(4000),
          });
          if (shaRes.ok) {
            shaMap = parseSha256SumsText(await shaRes.text());
          }
        } catch {
          // Optional checksum fetch failure should not block release parsing
        }
      }
    }

    return parseGitHubReleasePayload(payload, repo, shaMap);
  } catch {
    return buildEmptyDesktopReleaseInfo(
      repo,
      'coming_soon',
      'Unable to reach GitHub Releases right now.'
    );
  }
}
