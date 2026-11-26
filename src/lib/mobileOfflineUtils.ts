import type {
  BoundingBox,
  DatasetSourceType,
  DatasetSplit,
  EvaluationReport,
  Project,
  TrainedModel,
} from '../types/domain';

export interface CachedProjectSnapshot {
  id: string;
  project: Project;
  cachedAt: string;
  sourceState: 'synced' | 'cached_offline';
}

export interface CachedModelSnapshot {
  id: string;
  model: TrainedModel;
  cachedAt: string;
  sourceState: 'synced' | 'cached_offline';
}

export interface CachedReportSnapshot {
  id: string;
  report: EvaluationReport;
  cachedAt: string;
  sourceState: 'synced' | 'cached_offline';
}

export type OfflineQueueActionType = 'upload_dataset_item' | 'update_annotation';

export interface OfflineUploadDatasetPayload {
  datasetId: string;
  projectId: string;
  ownerUid: string;
  itemId: string;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  sourceType: DatasetSourceType;
  split: DatasetSplit;
  classificationLabel: string;
  annotations: BoundingBox[];
  blurScore: number;
  isApproved: boolean;
  totalItemsHint: number;
  annotatedCountHint: number;
}

export interface OfflineUpdateAnnotationPayload {
  datasetId: string;
  itemId: string;
  classificationLabel: string;
  annotations: BoundingBox[];
  isApproved: boolean;
  totalItemsHint: number;
  annotatedCountHint: number;
}

export interface OfflineSyncQueueEntry {
  id: string;
  type: OfflineQueueActionType;
  projectId: string;
  datasetId: string;
  itemId: string;
  storageLocation: 'local' | 'cloud';
  cloudConsentGranted: boolean;
  createdAt: number;
  status: 'pending_offline' | 'syncing' | 'failed';
  lastError?: string;
  payload: OfflineUploadDatasetPayload | OfflineUpdateAnnotationPayload;
}

export interface MobileStorageQuotaSummary {
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
  percentUsed: number;
}

export function sortSyncQueue(entries: OfflineSyncQueueEntry[]): OfflineSyncQueueEntry[] {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt);
}

export function validateQueueEntryConsent(entry: OfflineSyncQueueEntry): {
  allowed: boolean;
  reason?: string;
} {
  if (entry.storageLocation === 'cloud' && !entry.cloudConsentGranted) {
    return {
      allowed: false,
      reason: 'Explicit cloud upload consent is required before syncing private project datasets.',
    };
  }
  return { allowed: true };
}

export function summarizeStorageQuota(
  usageBytes?: number | null,
  quotaBytes?: number | null,
  supported = true
): MobileStorageQuotaSummary {
  const usage = Math.max(0, Number(usageBytes || 0));
  const quota = Math.max(0, Number(quotaBytes || 0));
  const pct = quota > 0 ? Math.min(100, Number(((usage / quota) * 100).toFixed(1))) : 0;
  return {
    supported,
    usageBytes: usage,
    quotaBytes: quota,
    percentUsed: pct,
  };
}

export function mergeCachedAndLiveProjects(
  liveProjects: Project[],
  cachedSnapshots: CachedProjectSnapshot[],
  isOnline: boolean
): Array<{ project: Project; syncState: 'synced' | 'cached_offline'; cachedAt?: string }> {
  if (isOnline && liveProjects.length > 0) {
    return liveProjects.map((p) => ({ project: p, syncState: 'synced' }));
  }
  const map = new Map<
    string,
    { project: Project; syncState: 'synced' | 'cached_offline'; cachedAt?: string }
  >();
  for (const snap of cachedSnapshots) {
    map.set(snap.id, {
      project: snap.project,
      syncState: 'cached_offline',
      cachedAt: snap.cachedAt,
    });
  }
  for (const p of liveProjects) {
    map.set(p.id, { project: p, syncState: isOnline ? 'synced' : 'cached_offline' });
  }
  return Array.from(map.values());
}
