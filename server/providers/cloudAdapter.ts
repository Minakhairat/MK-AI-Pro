import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Multi-Cloud Storage & Compute Provider Adapter Layer
 * Decouples MK AI storage & compute orchestration from any single cloud vendor.
 * Credentials are read strictly from backend environment variables and NEVER exposed to frontend code.
 */

export type StorageProviderType = 'local' | 's3' | 'gcs';
export type CloudProviderType = 'local' | 'gcp' | 'aws';

export interface StorageProviderDescriptor {
  provider: StorageProviderType;
  region: string;
  configured: boolean;
  supportsPrivateLocalFirst: boolean;
  description: string;
  validationErrors?: string[];
}

export interface StorageConfigValidation {
  provider: StorageProviderType;
  valid: boolean;
  errors: string[];
}

export interface StoragePutResult {
  key: string;
  sizeBytes: number;
  provider: StorageProviderType;
}

export interface ComputeProviderDescriptor {
  provider: CloudProviderType;
  aiEngineConfigured: boolean;
  supportsCpuWorkers: boolean;
  supportsGpuWorkers: boolean;
}

export interface StorageProvider {
  readonly providerType: StorageProviderType;
  validateConfig(): StorageConfigValidation;
  describe(): StorageProviderDescriptor;
  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string;
  putObject(key: string, data: Buffer | Uint8Array | string, contentType?: string): Promise<StoragePutResult>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<string[]>;
}

/** Backwards-compatible interface alias */
export type StorageAdapter = StorageProvider;

function sanitizePathSegment(value: string): string {
  const clean = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean || 'item';
}

function normalizeObjectKey(key: string): string {
  const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) {
    throw new Error('Invalid object key: path traversal segments are forbidden.');
  }
  return parts.join('/');
}

/**
 * Local filesystem storage provider for zero-credential local development.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly providerType: StorageProviderType = 'local';
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = path.resolve(
      rootDir || process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), '.mk_ai_storage')
    );
  }

  validateConfig(): StorageConfigValidation {
    return {
      provider: 'local',
      valid: true,
      errors: [],
    };
  }

  describe(): StorageProviderDescriptor {
    return {
      provider: 'local',
      region: 'local-filesystem',
      configured: true,
      supportsPrivateLocalFirst: true,
      description: 'Local filesystem storage provider (zero cloud credentials required)',
      validationErrors: [],
    };
  }

  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string {
    return `local/${sanitizePathSegment(ownerUid)}/${sanitizePathSegment(projectId)}/${sanitizePathSegment(filename)}`;
  }

  private resolveSafeDiskPath(key: string): string {
    const cleanKey = normalizeObjectKey(key);
    const resolved = path.resolve(this.rootDir, cleanKey);
    const rootWithSep = this.rootDir.endsWith(path.sep) ? this.rootDir : this.rootDir + path.sep;
    if (resolved !== this.rootDir && !resolved.startsWith(rootWithSep)) {
      throw new Error('Access denied: resolved storage path escapes storage root.');
    }
    return resolved;
  }

  async putObject(
    key: string,
    data: Buffer | Uint8Array | string,
    _contentType?: string
  ): Promise<StoragePutResult> {
    const targetPath = this.resolveSafeDiskPath(key);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    await fs.writeFile(targetPath, buf);
    return {
      key: normalizeObjectKey(key),
      sizeBytes: buf.byteLength,
      provider: 'local',
    };
  }

  async getObject(key: string): Promise<Buffer | null> {
    const targetPath = this.resolveSafeDiskPath(key);
    try {
      return await fs.readFile(targetPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const targetPath = this.resolveSafeDiskPath(key);
    try {
      await fs.unlink(targetPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    const cleanPrefix = prefix ? normalizeObjectKey(prefix) : '';
    const startDir = cleanPrefix ? this.resolveSafeDiskPath(cleanPrefix) : this.rootDir;
    const results: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const rel = path.relative(this.rootDir, full).split(path.sep).join('/');
          results.push(rel);
        }
      }
    };

    await walk(startDir);
    return results.sort();
  }
}

function hmacSha256(key: Buffer | string, msg: string): Buffer {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

function sha256Hex(payload: Buffer | string): string {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * S3-Compatible Storage Provider (AWS S3 & local MinIO).
 * Uses S3_BUCKET, S3_REGION, and optional S3_ENDPOINT strictly when STORAGE_PROVIDER=s3.
 */
export class S3StorageProvider implements StorageProvider {
  readonly providerType: StorageProviderType = 's3';
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.bucket = (env.S3_BUCKET || '').trim();
    this.region = (env.S3_REGION || '').trim();
    this.endpoint = (env.S3_ENDPOINT || '').trim();
    this.accessKeyId = (env.S3_ACCESS_KEY_ID || '').trim();
    this.secretAccessKey = (env.S3_SECRET_ACCESS_KEY || '').trim();
  }

  validateConfig(): StorageConfigValidation {
    const errors: string[] = [];
    if (!this.bucket) {
      errors.push('S3_BUCKET is required when STORAGE_PROVIDER=s3.');
    }
    if (!this.region) {
      errors.push('S3_REGION is required when STORAGE_PROVIDER=s3.');
    }
    if (this.endpoint) {
      try {
        const parsed = new URL(this.endpoint);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push('S3_ENDPOINT must use http:// or https:// protocol.');
        }
      } catch {
        errors.push('S3_ENDPOINT must be a valid URL (e.g. http://localhost:9000 for MinIO).');
      }
    }
    return {
      provider: 's3',
      valid: errors.length === 0,
      errors,
    };
  }

  describe(): StorageProviderDescriptor {
    const validation = this.validateConfig();
    return {
      provider: 's3',
      region: this.region || 'unconfigured',
      configured: validation.valid,
      supportsPrivateLocalFirst: false,
      description: this.endpoint
        ? 'S3-compatible object storage provider (MinIO / Custom Endpoint)'
        : 'AWS S3 object storage provider',
      validationErrors: validation.errors,
    };
  }

  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string {
    return `tenants/${sanitizePathSegment(ownerUid)}/projects/${sanitizePathSegment(projectId)}/${sanitizePathSegment(filename)}`;
  }

  private buildRequestTarget(cleanKey: string, query?: string): { url: URL; canonicalUri: string } {
    const encodedKey = cleanKey
      .split('/')
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join('/');

    if (this.endpoint) {
      const base = new URL(this.endpoint);
      const basePrefix = base.pathname.replace(/\/+$/, '');
      const canonicalUri = `${basePrefix}/${encodeURIComponent(this.bucket)}${encodedKey ? '/' + encodedKey : ''}`;
      const url = new URL(base.toString());
      url.pathname = canonicalUri;
      if (query) url.search = query;
      return { url, canonicalUri };
    }

    const host = `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
    const canonicalUri = `/${encodedKey}`;
    const url = new URL(host);
    url.pathname = canonicalUri;
    if (query) url.search = query;
    return { url, canonicalUri };
  }

  private async signedFetch(
    method: 'GET' | 'PUT' | 'DELETE',
    cleanKey: string,
    body?: Buffer,
    contentType?: string,
    query?: string
  ): Promise<Response> {
    const validation = this.validateConfig();
    if (!validation.valid) {
      throw new Error(validation.errors.join(' '));
    }
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required for S3 API requests.');
    }

    const { url, canonicalUri } = this.buildRequestTarget(cleanKey, query);
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = sha256Hex(payload);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const hostHeader = url.host;
    const canonicalQuery = query ? query.replace(/^\?/, '') : '';

    const headersToSign: Record<string, string> = {
      host: hostHeader,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) {
      headersToSign['content-type'] = contentType;
    }

    const sortedKeys = Object.keys(headersToSign).sort();
    const canonicalHeaders = sortedKeys.map((k) => `${k}:${headersToSign[k]}\n`).join('');
    const signedHeaders = sortedKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const fetchHeaders: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    };
    if (contentType) fetchHeaders['Content-Type'] = contentType;

    return fetch(url.toString(), {
      method,
      headers: fetchHeaders,
      body: method === 'PUT' ? new Uint8Array(payload) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  }

  async putObject(
    key: string,
    data: Buffer | Uint8Array | string,
    contentType = 'application/octet-stream'
  ): Promise<StoragePutResult> {
    const cleanKey = normalizeObjectKey(key);
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const res = await this.signedFetch('PUT', cleanKey, buf, contentType);
    if (!res.ok) {
      throw new Error(`S3 putObject failed (${res.status} ${res.statusText}).`);
    }
    return { key: cleanKey, sizeBytes: buf.byteLength, provider: 's3' };
  }

  async getObject(key: string): Promise<Buffer | null> {
    const cleanKey = normalizeObjectKey(key);
    const res = await this.signedFetch('GET', cleanKey);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`S3 getObject failed (${res.status} ${res.statusText}).`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const cleanKey = normalizeObjectKey(key);
    const res = await this.signedFetch('DELETE', cleanKey);
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      throw new Error(`S3 deleteObject failed (${res.status} ${res.statusText}).`);
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    const cleanPrefix = prefix ? normalizeObjectKey(prefix) : '';
    const query = `list-type=2&prefix=${encodeURIComponent(cleanPrefix)}`;
    const res = await this.signedFetch('GET', '', undefined, undefined, query);
    if (!res.ok) {
      throw new Error(`S3 listObjects failed (${res.status} ${res.statusText}).`);
    }
    const xml = await res.text();
    const keys: string[] = [];
    const regex = /<Key>([^<]+)<\/Key>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      keys.push(match[1]);
    }
    return keys;
  }
}

/**
 * Google Cloud Storage Provider.
 * Uses CLOUD_REGION and GCS_BUCKET strictly when STORAGE_PROVIDER=gcs.
 */
export class GCSStorageProvider implements StorageProvider {
  readonly providerType: StorageProviderType = 'gcs';
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessToken: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.bucket = (env.GCS_BUCKET || '').trim();
    this.region = (env.CLOUD_REGION || '').trim();
    this.accessToken = (env.GCS_ACCESS_TOKEN || '').trim();
  }

  validateConfig(): StorageConfigValidation {
    const errors: string[] = [];
    if (!this.bucket) {
      errors.push('GCS_BUCKET is required when STORAGE_PROVIDER=gcs.');
    }
    if (!this.region) {
      errors.push('CLOUD_REGION is required when STORAGE_PROVIDER=gcs.');
    }
    return {
      provider: 'gcs',
      valid: errors.length === 0,
      errors,
    };
  }

  describe(): StorageProviderDescriptor {
    const validation = this.validateConfig();
    return {
      provider: 'gcs',
      region: this.region || 'unconfigured',
      configured: validation.valid,
      supportsPrivateLocalFirst: false,
      description: 'Google Cloud Storage provider',
      validationErrors: validation.errors,
    };
  }

  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string {
    return `tenants/${sanitizePathSegment(ownerUid)}/projects/${sanitizePathSegment(projectId)}/${sanitizePathSegment(filename)}`;
  }

  private async getBearerToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    try {
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
      });
      const token = await auth.getAccessToken();
      if (token) return token;
    } catch {
      // Fallback error below
    }
    throw new Error(
      'GCS credentials unavailable. Configure Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS) or GCS_ACCESS_TOKEN on the backend.'
    );
  }

  async putObject(
    key: string,
    data: Buffer | Uint8Array | string,
    contentType = 'application/octet-stream'
  ): Promise<StoragePutResult> {
    const validation = this.validateConfig();
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const cleanKey = normalizeObjectKey(key);
    const token = await this.getBearerToken();
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(cleanKey)}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`GCS putObject failed (${res.status} ${res.statusText}).`);
    }
    return { key: cleanKey, sizeBytes: buf.byteLength, provider: 'gcs' };
  }

  async getObject(key: string): Promise<Buffer | null> {
    const validation = this.validateConfig();
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const cleanKey = normalizeObjectKey(key);
    const token = await this.getBearerToken();
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(cleanKey)}?alt=media`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GCS getObject failed (${res.status} ${res.statusText}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const validation = this.validateConfig();
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const cleanKey = normalizeObjectKey(key);
    const token = await this.getBearerToken();
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(cleanKey)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      throw new Error(`GCS deleteObject failed (${res.status} ${res.statusText}).`);
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    const validation = this.validateConfig();
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    const cleanPrefix = prefix ? normalizeObjectKey(prefix) : '';
    const token = await this.getBearerToken();
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o?prefix=${encodeURIComponent(cleanPrefix)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GCS listObjects failed (${res.status} ${res.statusText}).`);
    const json = (await res.json()) as { items?: { name: string }[] };
    return (json.items || []).map((item) => item.name);
  }
}

export function resolveConfiguredStorageType(
  env: NodeJS.ProcessEnv = process.env
): StorageProviderType {
  const mode = (env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
  if (mode === 's3' || mode === 'gcs' || mode === 'local') {
    return mode;
  }
  throw new Error(
    `Unsupported STORAGE_PROVIDER "${mode}". Allowed values are "local", "s3", or "gcs".`
  );
}

export function createStorageProvider(
  env: NodeJS.ProcessEnv = process.env
): StorageProvider {
  const mode = resolveConfiguredStorageType(env);
  if (mode === 's3') return new S3StorageProvider(env);
  if (mode === 'gcs') return new GCSStorageProvider(env);
  return new LocalStorageProvider(env.LOCAL_STORAGE_DIR);
}

export function validateStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): StorageConfigValidation {
  try {
    return createStorageProvider(env).validateConfig();
  } catch (err) {
    return {
      provider: 'local',
      valid: false,
      errors: [err instanceof Error ? err.message : 'Invalid STORAGE_PROVIDER configuration.'],
    };
  }
}

/** Backwards-compatible aliases */
export const LocalStorageAdapter = LocalStorageProvider;
export const S3CompatibleStorageAdapter = S3StorageProvider;
export const GcsStorageAdapter = GCSStorageProvider;
export function getStorageAdapter(): StorageProvider {
  return createStorageProvider(process.env);
}

export function getComputeDescriptor(): ComputeProviderDescriptor {
  const raw = (process.env.CLOUD_PROVIDER || 'local').toLowerCase();
  const provider: CloudProviderType =
    raw === 'gcp' || raw === 'aws' ? raw : 'local';

  return {
    provider,
    aiEngineConfigured: Boolean(process.env.AI_ENGINE_URL),
    supportsCpuWorkers: true,
    supportsGpuWorkers: provider !== 'local',
  };
}
