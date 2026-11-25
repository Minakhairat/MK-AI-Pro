/**
 * Multi-Cloud Provider Adapter Layer
 * Decouples MK AI storage & compute orchestration from any single cloud vendor.
 * Configured strictly via backend environment variables.
 */

export type StorageProviderType = 'local' | 's3' | 'gcs';
export type CloudProviderType = 'local' | 'gcp' | 'aws';

export interface StorageProviderDescriptor {
  provider: StorageProviderType;
  region: string;
  configured: boolean;
  supportsPrivateLocalFirst: boolean;
  description: string;
}

export interface ComputeProviderDescriptor {
  provider: CloudProviderType;
  aiEngineConfigured: boolean;
  supportsCpuWorkers: boolean;
  supportsGpuWorkers: boolean;
}

export interface StorageAdapter {
  describe(): StorageProviderDescriptor;
  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string;
}

export class LocalStorageAdapter implements StorageAdapter {
  describe(): StorageProviderDescriptor {
    return {
      provider: 'local',
      region: 'local-device',
      configured: true,
      supportsPrivateLocalFirst: true,
      description: 'Local-first storage adapter (IndexedDB / local workspace volume)',
    };
  }

  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `local/${ownerUid}/${projectId}/${safeName}`;
  }
}

export class S3CompatibleStorageAdapter implements StorageAdapter {
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET || '';
    this.region = process.env.S3_REGION || 'us-east-1';
    this.endpoint = process.env.S3_ENDPOINT || '';
  }

  describe(): StorageProviderDescriptor {
    return {
      provider: 's3',
      region: this.region,
      configured: Boolean(this.bucket),
      supportsPrivateLocalFirst: false,
      description: this.endpoint
        ? 'S3-compatible object storage adapter'
        : 'AWS S3 object storage adapter',
    };
  }

  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `tenants/${ownerUid}/projects/${projectId}/${safeName}`;
  }
}

export class GcsStorageAdapter implements StorageAdapter {
  private readonly region: string;

  constructor() {
    this.region = process.env.CLOUD_REGION || 'europe-west3';
  }

  describe(): StorageProviderDescriptor {
    return {
      provider: 'gcs',
      region: this.region,
      configured: Boolean(process.env.GCS_BUCKET),
      supportsPrivateLocalFirst: false,
      description: 'Google Cloud Storage adapter',
    };
  }

  resolveObjectKey(ownerUid: string, projectId: string, filename: string): string {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `tenants/${ownerUid}/projects/${projectId}/${safeName}`;
  }
}

export function getStorageAdapter(): StorageAdapter {
  const mode = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
  if (mode === 's3') return new S3CompatibleStorageAdapter();
  if (mode === 'gcs') return new GcsStorageAdapter();
  return new LocalStorageAdapter();
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
