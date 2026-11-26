import type { EvaluationReport, Project, TrainedModel } from '../types/domain';
import {
  addDatasetItem,
  syncDatasetCounters,
  updateDatasetItemAnnotation,
} from '../services/firestoreService';
import {
  type CachedModelSnapshot,
  type CachedProjectSnapshot,
  type CachedReportSnapshot,
  type MobileStorageQuotaSummary,
  type OfflineQueueActionType,
  type OfflineSyncQueueEntry,
  type OfflineUpdateAnnotationPayload,
  type OfflineUploadDatasetPayload,
  mergeCachedAndLiveProjects,
  sortSyncQueue,
  summarizeStorageQuota,
  validateQueueEntryConsent,
} from './mobileOfflineUtils';

export {
  type CachedModelSnapshot,
  type CachedProjectSnapshot,
  type CachedReportSnapshot,
  type MobileStorageQuotaSummary,
  type OfflineQueueActionType,
  type OfflineSyncQueueEntry,
  type OfflineUpdateAnnotationPayload,
  type OfflineUploadDatasetPayload,
  mergeCachedAndLiveProjects,
  sortSyncQueue,
  summarizeStorageQuota,
  validateQueueEntryConsent,
};

const DB_NAME = 'mk_ai_mobile_offline_v1';
const DB_VERSION = 1;
const STORE_PROJECTS = 'cached_projects';
const STORE_MODELS = 'cached_models';
const STORE_REPORTS = 'cached_reports';
const STORE_QUEUE = 'sync_queue';

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const q = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        q.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline IndexedDB store.'));
  });
}

function txPutAll<T>(storeName: string, records: T[]): Promise<void> {
  if (typeof indexedDB === 'undefined' || records.length === 0) return Promise.resolve();
  return openOfflineDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const rec of records) {
          store.put(rec);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`Failed writing ${storeName}`));
      })
  );
}

function txGetAll<T>(storeName: string): Promise<T[]> {
  if (typeof indexedDB === 'undefined') return Promise.resolve([]);
  return openOfflineDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as T[]) : []);
        req.onerror = () => reject(req.error || new Error(`Failed reading ${storeName}`));
      })
  );
}

function txDelete(storeName: string, id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return openOfflineDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`Failed deleting from ${storeName}`));
      })
  );
}

export async function cacheProjectSnapshots(projects: Project[]): Promise<void> {
  const now = new Date().toISOString();
  const records: CachedProjectSnapshot[] = projects.map((project) => ({
    id: project.id,
    project: {
      ...project,
      createdAt: null,
      updatedAt: null,
    },
    cachedAt: now,
    sourceState: 'synced',
  }));
  await txPutAll(STORE_PROJECTS, records).catch(() => {});
}

export async function listCachedProjectSnapshots(): Promise<CachedProjectSnapshot[]> {
  return txGetAll<CachedProjectSnapshot>(STORE_PROJECTS).catch(() => []);
}

export async function cacheModelSnapshots(models: TrainedModel[]): Promise<void> {
  const now = new Date().toISOString();
  const records: CachedModelSnapshot[] = models.map((model) => ({
    id: model.id,
    model: {
      ...model,
      createdAt: null,
      updatedAt: null,
    },
    cachedAt: now,
    sourceState: 'synced',
  }));
  await txPutAll(STORE_MODELS, records).catch(() => {});
}

export async function listCachedModelSnapshots(): Promise<CachedModelSnapshot[]> {
  return txGetAll<CachedModelSnapshot>(STORE_MODELS).catch(() => []);
}

export async function cacheEvaluationReportSnapshots(reports: EvaluationReport[]): Promise<void> {
  const now = new Date().toISOString();
  const records: CachedReportSnapshot[] = reports.map((report) => ({
    id: report.id,
    report: {
      ...report,
      createdAt: null,
    },
    cachedAt: now,
    sourceState: 'synced',
  }));
  await txPutAll(STORE_REPORTS, records).catch(() => {});
}

export async function listCachedReportSnapshots(): Promise<CachedReportSnapshot[]> {
  return txGetAll<CachedReportSnapshot>(STORE_REPORTS).catch(() => []);
}

export async function enqueueOfflineSyncAction(
  entry: Omit<OfflineSyncQueueEntry, 'id' | 'createdAt' | 'status'>
): Promise<OfflineSyncQueueEntry> {
  const full: OfflineSyncQueueEntry = {
    ...entry,
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    status: 'pending_offline',
  };
  await txPutAll(STORE_QUEUE, [full]);
  return full;
}

export async function listOfflineSyncQueue(): Promise<OfflineSyncQueueEntry[]> {
  const raw = await txGetAll<OfflineSyncQueueEntry>(STORE_QUEUE).catch(() => []);
  return sortSyncQueue(raw);
}

export async function removeOfflineSyncEntry(id: string): Promise<void> {
  await txDelete(STORE_QUEUE, id);
}

export async function getMobileStorageQuota(): Promise<MobileStorageQuotaSummary> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return summarizeStorageQuota(0, 0, false);
  }
  try {
    const est = await navigator.storage.estimate();
    return summarizeStorageQuota(est.usage ?? 0, est.quota ?? 0, true);
  } catch {
    return summarizeStorageQuota(0, 0, false);
  }
}

export async function flushOfflineSyncQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skippedConsent: number;
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processed: 0, succeeded: 0, failed: 0, skippedConsent: 0 };
  }

  const entries = await listOfflineSyncQueue();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skippedConsent = 0;

  for (const entry of entries) {
    const consentCheck = validateQueueEntryConsent(entry);
    if (!consentCheck.allowed) {
      skippedConsent += 1;
      await txPutAll(STORE_QUEUE, [
        { ...entry, status: 'failed', lastError: consentCheck.reason },
      ]);
      continue;
    }

    processed += 1;
    try {
      await txPutAll(STORE_QUEUE, [{ ...entry, status: 'syncing', lastError: undefined }]);
      if (entry.type === 'upload_dataset_item') {
        const p = entry.payload as OfflineUploadDatasetPayload;
        await addDatasetItem({
          datasetId: p.datasetId,
          projectId: p.projectId,
          ownerUid: p.ownerUid,
          filename: p.filename,
          mimeType: p.mimeType,
          width: p.width,
          height: p.height,
          sizeBytes: p.sizeBytes,
          sha256: p.sha256,
          sourceType: p.sourceType,
          split: p.split,
          classificationLabel: p.classificationLabel,
          annotations: p.annotations,
          blurScore: p.blurScore,
          isApproved: p.isApproved,
        });
        await syncDatasetCounters({
          datasetId: p.datasetId,
          imageCount: p.totalItemsHint,
          annotatedCount: p.annotatedCountHint,
        });
      } else if (entry.type === 'update_annotation') {
        const p = entry.payload as OfflineUpdateAnnotationPayload;
        await updateDatasetItemAnnotation({
          datasetId: p.datasetId,
          itemId: p.itemId,
          classificationLabel: p.classificationLabel,
          annotations: p.annotations,
          isApproved: p.isApproved,
        });
        await syncDatasetCounters({
          datasetId: p.datasetId,
          imageCount: p.totalItemsHint,
          annotatedCount: p.annotatedCountHint,
        });
      }
      await txDelete(STORE_QUEUE, entry.id);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      await txPutAll(STORE_QUEUE, [
        {
          ...entry,
          status: 'failed',
          lastError: err instanceof Error ? err.message : 'Sync failed',
        },
      ]);
    }
  }

  return { processed, succeeded, failed, skippedConsent };
}
