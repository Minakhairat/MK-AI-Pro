/**
 * Local-First Binary Media Store (IndexedDB)
 * Stores raw image blobs on-device keyed by DatasetItem ID so binary media
 * never exceeds Firestore's 1MB document limit and stays private by default.
 */

const DB_NAME = 'mk_ai_media_v1';
const STORE_NAME = 'dataset_blobs';
const DB_VERSION = 1;

interface StoredMediaRecord {
  itemId: string;
  datasetId: string;
  blob: Blob;
  savedAt: number;
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'itemId' });
        store.createIndex('datasetId', 'datasetId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
}

export async function saveMediaBlob(
  itemId: string,
  datasetId: string,
  blob: Blob
): Promise<void> {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: StoredMediaRecord = {
      itemId,
      datasetId,
      blob,
      savedAt: Date.now(),
    };
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to store media blob.'));
  });
}

export async function getMediaBlob(itemId: string): Promise<Blob | null> {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(itemId);
    req.onsuccess = () => {
      const result = req.result as StoredMediaRecord | undefined;
      resolve(result?.blob ?? null);
    };
    req.onerror = () => reject(req.error || new Error('Failed to load media blob.'));
  });
}

export async function deleteMediaBlob(itemId: string): Promise<void> {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(itemId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete media blob.'));
  });
}

export async function deleteDatasetMediaBlobs(datasetId: string): Promise<void> {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('datasetId');
    const req = index.getAllKeys(IDBKeyRange.only(datasetId));
    req.onsuccess = () => {
      for (const key of req.result) {
        store.delete(key);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear dataset media blobs.'));
  });
}
