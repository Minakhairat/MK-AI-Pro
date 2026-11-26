import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopWeightRecord } from '../../src/types/desktop.ts';
import {
  type DesktopStorageManager,
  resolveConfinedPath,
  sanitizeSegment,
} from './storageManager.ts';

export const ALLOWED_WEIGHT_HOSTS = [
  'https://github.com/',
  'https://objects.githubusercontent.com/',
  'https://release-assets.githubusercontent.com/',
  'https://huggingface.co/',
  'https://storage.googleapis.com/',
  'https://download.pytorch.org/',
];

export function validateWeightDownloadUrl(rawUrl: string): URL {
  if (rawUrl.includes('..') || rawUrl.toLowerCase().includes('%2e%2e')) {
    throw new Error('Unsafe path traversal blocked in weight URL.');
  }
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Insecure weight URL rejected (${parsed.protocol}). HTTPS required.`);
  }
  const normalized = parsed.toString();
  if (!ALLOWED_WEIGHT_HOSTS.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`Untrusted weight host rejected: ${parsed.origin}`);
  }
  return parsed;
}

export class DesktopModelDownloadManager {
  private storage: DesktopStorageManager;
  private indexFile: string;

  constructor(storage: DesktopStorageManager) {
    this.storage = storage;
    this.indexFile = resolveConfinedPath(storage.getSubdir('model_weights'), 'weights-index.json');
  }

  private readIndex(): DesktopWeightRecord[] {
    if (!fs.existsSync(this.indexFile)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      return Array.isArray(parsed) ? (parsed as DesktopWeightRecord[]) : [];
    } catch {
      return [];
    }
  }

  private writeIndex(records: DesktopWeightRecord[]): void {
    fs.mkdirSync(path.dirname(this.indexFile), { recursive: true });
    fs.writeFileSync(this.indexFile, JSON.stringify(records, null, 2), 'utf8');
  }

  listWeights(): DesktopWeightRecord[] {
    const records = this.readIndex();
    return records.filter((r) => fs.existsSync(r.localPath));
  }

  async inspectRemoteSize(rawUrl: string): Promise<number | null> {
    const url = validateWeightDownloadUrl(rawUrl);
    try {
      const head = await fetch(url.toString(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(8000),
      });
      if (!head.ok) return null;
      const len = Number.parseInt(head.headers.get('content-length') || '0', 10);
      return Number.isFinite(len) && len > 0 ? len : null;
    } catch {
      return null;
    }
  }

  async downloadWeight(params: {
    catalogModelId: string;
    url: string;
    expectedSha256?: string;
    license: string;
    version?: string;
  }): Promise<DesktopWeightRecord> {
    const url = validateWeightDownloadUrl(params.url);
    const weightsDir = this.storage.getSubdir('model_weights');
    const safeId = sanitizeSegment(params.catalogModelId, 'model');
    const verTag = sanitizeSegment(params.version || 'v1', 'v1');
    const ext = path.extname(url.pathname) || '.bin';
    const filename = `${safeId}_${verTag}${ext}`;
    const finalPath = resolveConfinedPath(weightsDir, filename);
    const partPath = resolveConfinedPath(weightsDir, `${filename}.part`);

    // Reuse cached verified file if already present
    const existingIdx = this.readIndex();
    const existing = existingIdx.find(
      (r) => r.catalogModelId === params.catalogModelId && r.version === verTag && fs.existsSync(r.localPath)
    );
    if (existing) {
      const currentSha = await this.computeFileSha256(existing.localPath);
      if (currentSha === existing.sha256) {
        return existing;
      }
    }

    // Resume partial download if supported
    const resumeOffset = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
    const headers: Record<string, string> = {};
    if (resumeOffset > 0) {
      headers['Range'] = `bytes=${resumeOffset}-`;
    }

    const res = await fetch(url.toString(), { headers });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Weight download failed (${res.status} ${res.statusText}).`);
    }

    const appending = res.status === 206 && resumeOffset > 0;
    if (!appending && fs.existsSync(partPath)) {
      fs.rmSync(partPath, { force: true });
    }

    const bodyBuf = Buffer.from(await res.arrayBuffer());
    if (appending) {
      fs.appendFileSync(partPath, bodyBuf);
    } else {
      fs.writeFileSync(partPath, bodyBuf);
    }

    const sha256 = await this.computeFileSha256(partPath);
    if (params.expectedSha256 && sha256.toLowerCase() !== params.expectedSha256.toLowerCase()) {
      fs.rmSync(partPath, { force: true });
      throw new Error(
        `SHA-256 checksum mismatch for ${filename}. Expected ${params.expectedSha256.slice(0, 12)}, got ${sha256.slice(0, 12)}.`
      );
    }

    let previousVersionPath: string | undefined;
    const prevRecord = existingIdx.find((r) => r.catalogModelId === params.catalogModelId);
    if (prevRecord && fs.existsSync(prevRecord.localPath) && prevRecord.localPath !== finalPath) {
      previousVersionPath = prevRecord.localPath;
    }

    fs.renameSync(partPath, finalPath);
    const stat = fs.statSync(finalPath);

    const nextRecord: DesktopWeightRecord = {
      id: `${safeId}_${verTag}`,
      catalogModelId: params.catalogModelId,
      filename,
      localPath: finalPath,
      sizeBytes: stat.size,
      sha256,
      sourceUrl: params.url,
      version: verTag,
      license: params.license,
      downloadedAt: new Date().toISOString(),
      previousVersionPath,
    };

    const filtered = existingIdx.filter((r) => r.catalogModelId !== params.catalogModelId);
    filtered.push(nextRecord);
    this.writeIndex(filtered);
    return nextRecord;
  }

  rollbackWeight(catalogModelId: string): DesktopWeightRecord | null {
    const records = this.readIndex();
    const current = records.find((r) => r.catalogModelId === catalogModelId);
    if (!current || !current.previousVersionPath || !fs.existsSync(current.previousVersionPath)) {
      return null;
    }
    const prevPath = current.previousVersionPath;
    const prevStat = fs.statSync(prevPath);
    const prevSha = crypto.createHash('sha256').update(fs.readFileSync(prevPath)).digest('hex');
    const restored: DesktopWeightRecord = {
      ...current,
      filename: path.basename(prevPath),
      localPath: prevPath,
      sizeBytes: prevStat.size,
      sha256: prevSha,
      version: `${current.version}-rollback`,
      previousVersionPath: current.localPath,
    };
    const nextList = records.map((r) => (r.catalogModelId === catalogModelId ? restored : r));
    this.writeIndex(nextList);
    return restored;
  }

  private computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
