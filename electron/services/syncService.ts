import type { SyncConflictRecord } from '../../src/types/desktop.ts';
import type { DesktopStorageManager } from './storageManager.ts';

export interface SyncableEntitySummary {
  entityType: 'project' | 'dataset' | 'model';
  entityId: string;
  name: string;
  updatedAt: string;
}

export function detectSyncConflicts(
  localRecords: SyncableEntitySummary[],
  cloudRecords: SyncableEntitySummary[]
): SyncConflictRecord[] {
  const cloudMap = new Map<string, SyncableEntitySummary>();
  for (const item of cloudRecords) {
    cloudMap.set(`${item.entityType}:${item.entityId}`, item);
  }

  const conflicts: SyncConflictRecord[] = [];
  for (const local of localRecords) {
    const cloud = cloudMap.get(`${local.entityType}:${local.entityId}`);
    if (!cloud) continue;
    const localTs = Date.parse(local.updatedAt || '');
    const cloudTs = Date.parse(cloud.updatedAt || '');
    if (
      Number.isFinite(localTs) &&
      Number.isFinite(cloudTs) &&
      Math.abs(localTs - cloudTs) > 2000 &&
      local.updatedAt !== cloud.updatedAt
    ) {
      conflicts.push({
        entityType: local.entityType,
        entityId: local.entityId,
        name: local.name || cloud.name,
        localUpdatedAt: local.updatedAt,
        cloudUpdatedAt: cloud.updatedAt,
        resolution: 'pending',
      });
    }
  }
  return conflicts;
}

export class DesktopSyncService {
  private storage: DesktopStorageManager;

  constructor(storage: DesktopStorageManager) {
    this.storage = storage;
  }

  canSyncToCloud(): { allowed: boolean; reason?: string } {
    const cfg = this.storage.getConfig();
    if (!cfg.cloudSyncConsentGranted) {
      return {
        allowed: false,
        reason:
          'Cloud sync is disabled. Enable explicit Cloud Sync consent in Desktop settings before uploading local metadata.',
      };
    }
    return { allowed: true };
  }

  listLocalProjectsAsSyncSummaries(): SyncableEntitySummary[] {
    const projects = this.storage.listProjectMetadata();
    return projects
      .filter((p) => typeof p.id === 'string')
      .map((p) => ({
        entityType: 'project' as const,
        entityId: String(p.id),
        name: typeof p.name === 'string' ? p.name : String(p.id),
        updatedAt:
          typeof p.localSavedAt === 'string'
            ? p.localSavedAt
            : typeof p.updatedAt === 'string'
            ? p.updatedAt
            : new Date().toISOString(),
      }));
  }

  compareWithCloudRecords(cloudRecords: SyncableEntitySummary[]): {
    consentGranted: boolean;
    localProjectCount: number;
    conflicts: SyncConflictRecord[];
  } {
    const cfg = this.storage.getConfig();
    const localSummaries = this.listLocalProjectsAsSyncSummaries();
    const conflicts = detectSyncConflicts(localSummaries, cloudRecords);
    return {
      consentGranted: cfg.cloudSyncConsentGranted,
      localProjectCount: localSummaries.length,
      conflicts,
    };
  }
}
