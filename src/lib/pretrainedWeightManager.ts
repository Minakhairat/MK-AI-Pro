import * as tf from '@tensorflow/tfjs';
import type { CachedCheckpointRecord } from '../types/domain';

export const ALLOWED_MODEL_ORIGINS = ['https://storage.googleapis.com/tfjs-models/'];
const CHECKPOINT_DB_NAME = 'mk_ai_pretrained_checkpoints_v1';
const CHECKPOINT_DB_VERSION = 1;
const CHECKPOINT_STORE = 'checkpoints';

export const COCO_CLASSES: string[] = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog',
  'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella',
  'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite',
  'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich',
  'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote',
  'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book',
  'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
];

/** Exact 1..90 slot mapping matching TF.js ssdlite_mobilenet_v2 Postprocessor/Slice indices 0..89 */
export const COCO_90_LABELS: Record<number, string> = {
  0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 4: 'airplane', 5: 'bus',
  6: 'train', 7: 'truck', 8: 'boat', 9: 'traffic light', 10: 'fire hydrant',
  12: 'stop sign', 13: 'parking meter', 14: 'bench', 15: 'bird', 16: 'cat',
  17: 'dog', 18: 'horse', 19: 'sheep', 20: 'cow', 21: 'elephant', 22: 'bear',
  23: 'zebra', 24: 'giraffe', 26: 'backpack', 27: 'umbrella', 30: 'handbag',
  31: 'tie', 32: 'suitcase', 33: 'frisbee', 34: 'skis', 35: 'snowboard',
  36: 'sports ball', 37: 'kite', 38: 'baseball bat', 39: 'baseball glove',
  40: 'skateboard', 41: 'surfboard', 42: 'tennis racket', 43: 'bottle',
  45: 'wine glass', 46: 'cup', 47: 'fork', 48: 'knife', 49: 'spoon',
  50: 'bowl', 51: 'banana', 52: 'apple', 53: 'sandwich', 54: 'orange',
  55: 'broccoli', 56: 'carrot', 57: 'hot dog', 58: 'pizza', 59: 'donut',
  60: 'cake', 61: 'chair', 62: 'couch', 63: 'potted plant', 64: 'bed',
  66: 'dining table', 69: 'toilet', 71: 'tv', 72: 'laptop', 73: 'mouse',
  74: 'remote', 75: 'keyboard', 76: 'cell phone', 77: 'microwave', 78: 'oven',
  79: 'toaster', 80: 'sink', 81: 'refrigerator', 83: 'book', 84: 'clock',
  85: 'vase', 86: 'scissors', 87: 'teddy bear', 88: 'hair drier', 89: 'toothbrush',
};

export function validateCheckpointUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid pretrained checkpoint URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Insecure checkpoint protocol rejected (${parsed.protocol}). HTTPS required.`);
  }
  const normalized = parsed.toString();
  if (!ALLOWED_MODEL_ORIGINS.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(
      `Checkpoint origin rejected (${parsed.origin}). Only verified TF.js model origins are allowed.`
    );
  }
  if (normalized.includes('..')) {
    throw new Error('Path traversal detected in checkpoint URL.');
  }
  return parsed;
}

export function resolveCheckpointShardUrl(baseModelJsonUrl: URL, shardPath: string): URL {
  if (!shardPath || shardPath.includes('..') || shardPath.startsWith('http://') || shardPath.startsWith('https://')) {
    throw new Error(`Unsafe weight shard path rejected: ${shardPath}`);
  }
  const resolved = new URL(shardPath, baseModelJsonUrl);
  if (resolved.origin !== baseModelJsonUrl.origin) {
    throw new Error(`Cross-origin shard redirect rejected: ${resolved.origin}`);
  }
  return validateCheckpointUrl(resolved.toString());
}

export async function computeSha256Hex(chunks: ArrayBuffer[]): Promise<string> {
  const totalBytes = chunks.reduce((acc, buf) => acc + buf.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', combined.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openCheckpointDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }
    const req = indexedDB.open(CHECKPOINT_DB_NAME, CHECKPOINT_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHECKPOINT_STORE)) {
        db.createObjectStore(CHECKPOINT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open checkpoint store'));
  });
}

export async function getCachedCheckpoint(id: string): Promise<CachedCheckpointRecord | null> {
  if (!hasIndexedDb()) return null;
  const db = await openCheckpointDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE, 'readonly');
    const req = tx.objectStore(CHECKPOINT_STORE).get(id);
    req.onsuccess = () => resolve((req.result as CachedCheckpointRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to read cached checkpoint'));
  });
}

export async function listCachedCheckpoints(): Promise<CachedCheckpointRecord[]> {
  if (!hasIndexedDb()) return [];
  const db = await openCheckpointDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE, 'readonly');
    const req = tx.objectStore(CHECKPOINT_STORE).getAll();
    req.onsuccess = () => resolve((req.result as CachedCheckpointRecord[]) ?? []);
    req.onerror = () => reject(req.error ?? new Error('Failed to list cached checkpoints'));
  });
}

export async function saveCachedCheckpoint(record: CachedCheckpointRecord): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openCheckpointDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE, 'readwrite');
    tx.objectStore(CHECKPOINT_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to cache pretrained checkpoint'));
  });
}

export async function deleteCachedCheckpoint(id: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openCheckpointDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE, 'readwrite');
    tx.objectStore(CHECKPOINT_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete cached checkpoint'));
  });
}

export async function verifyCachedCheckpointIntegrity(
  record: CachedCheckpointRecord
): Promise<{ valid: boolean; computedSha256: string }> {
  const topologyBytes = new TextEncoder().encode(record.modelTopologyJson).buffer;
  const specsBytes = new TextEncoder().encode(record.weightSpecsJson).buffer;
  const weightBuffer = base64ToArrayBuffer(record.weightDataBase64);
  const computedSha256 = await computeSha256Hex([topologyBytes, specsBytes, weightBuffer]);
  return {
    valid: weightBuffer.byteLength > 0 && computedSha256 === record.sha256,
    computedSha256,
  };
}

interface TfjsManifestGroup {
  paths: string[];
  weights: tf.io.WeightsManifestEntry[];
}

interface TfjsModelJsonPayload {
  format?: string;
  modelTopology?: Record<string, unknown>;
  weightsManifest?: TfjsManifestGroup[];
}

export async function downloadAndCachePretrainedCheckpoint(params: {
  catalogModelId: string;
  checkpointUrl: string;
  isGraphModel: boolean;
  onProgress?: (message: string) => void;
}): Promise<CachedCheckpointRecord> {
  const existing = await getCachedCheckpoint(params.catalogModelId);
  if (existing) {
    const check = await verifyCachedCheckpointIntegrity(existing);
    if (check.valid) {
      params.onProgress?.(
        `Verified offline checkpoint cache (${(existing.totalBytes / 1024 / 1024).toFixed(2)} MB, SHA-256 ${existing.sha256.slice(0, 12)}...).`
      );
      return existing;
    }
    await deleteCachedCheckpoint(params.catalogModelId);
  }

  const baseUrl = validateCheckpointUrl(params.checkpointUrl);
  params.onProgress?.(`Fetching checkpoint manifest from ${baseUrl.hostname}...`);

  const manifestRes = await fetch(baseUrl.toString());
  if (!manifestRes.ok) {
    throw new Error(
      `Pretrained checkpoint download failed (${manifestRes.status} ${manifestRes.statusText}). Training cannot proceed with uninitialized random weights.`
    );
  }

  const payload = (await manifestRes.json()) as TfjsModelJsonPayload;
  if (!payload.modelTopology || !Array.isArray(payload.weightsManifest) || payload.weightsManifest.length === 0) {
    throw new Error('Invalid TF.js model.json manifest: missing modelTopology or weightsManifest.');
  }

  const weightSpecs: tf.io.WeightsManifestEntry[] = [];
  const shardBuffers: ArrayBuffer[] = [];

  for (const group of payload.weightsManifest) {
    weightSpecs.push(...group.weights);
    for (const shardPath of group.paths) {
      const shardUrl = resolveCheckpointShardUrl(baseUrl, shardPath);
      params.onProgress?.(`Downloading shard ${shardPath}...`);
      const shardRes = await fetch(shardUrl.toString());
      if (!shardRes.ok) {
        throw new Error(
          `Failed to download weight shard ${shardPath} (${shardRes.status}). Aborting without random fallback.`
        );
      }
      const buf = await shardRes.arrayBuffer();
      if (buf.byteLength === 0) {
        throw new Error(`Empty weight shard received for ${shardPath}.`);
      }
      shardBuffers.push(buf);
    }
  }

  const totalWeightBytes = shardBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  if (totalWeightBytes === 0) {
    throw new Error('Downloaded checkpoint contains zero weight bytes.');
  }

  const combinedWeights = new Uint8Array(totalWeightBytes);
  let offset = 0;
  for (const buf of shardBuffers) {
    combinedWeights.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  const modelTopologyJson = JSON.stringify(payload.modelTopology);
  const weightSpecsJson = JSON.stringify(weightSpecs);
  const sha256 = await computeSha256Hex([
    new TextEncoder().encode(modelTopologyJson).buffer,
    new TextEncoder().encode(weightSpecsJson).buffer,
    combinedWeights.buffer,
  ]);

  const now = new Date().toISOString();
  const record: CachedCheckpointRecord = {
    id: params.catalogModelId,
    catalogModelId: params.catalogModelId,
    checkpointUrl: params.checkpointUrl,
    isGraphModel: params.isGraphModel,
    modelTopologyJson,
    weightSpecsJson,
    weightDataBase64: arrayBufferToBase64(combinedWeights.buffer),
    sha256,
    totalBytes: totalWeightBytes,
    downloadedAt: now,
    verifiedAt: now,
  };

  await saveCachedCheckpoint(record);
  params.onProgress?.(
    `Checkpoint cached & SHA-256 verified (${(totalWeightBytes / 1024 / 1024).toFixed(2)} MB · ${sha256.slice(0, 12)}...).`
  );
  return record;
}

export async function loadCachedCheckpointLayersModel(
  record: CachedCheckpointRecord
): Promise<tf.LayersModel> {
  if (record.isGraphModel) {
    throw new Error(`Checkpoint ${record.catalogModelId} is a frozen GraphModel and cannot be loaded as a LayersModel.`);
  }
  const check = await verifyCachedCheckpointIntegrity(record);
  if (!check.valid) {
    throw new Error(
      `Checkpoint SHA-256 integrity verification failed for ${record.catalogModelId}. Please re-download.`
    );
  }
  const modelTopology = JSON.parse(record.modelTopologyJson) as Record<string, unknown>;
  const weightSpecs = JSON.parse(record.weightSpecsJson) as tf.io.WeightsManifestEntry[];
  const weightData = base64ToArrayBuffer(record.weightDataBase64);
  return tf.loadLayersModel(tf.io.fromMemory({ modelTopology, weightSpecs, weightData }));
}

export async function loadCachedCheckpointGraphModel(
  record: CachedCheckpointRecord
): Promise<tf.GraphModel> {
  if (!record.isGraphModel) {
    throw new Error(`Checkpoint ${record.catalogModelId} is a LayersModel, not a GraphModel.`);
  }
  const check = await verifyCachedCheckpointIntegrity(record);
  if (!check.valid) {
    throw new Error(
      `Checkpoint SHA-256 integrity verification failed for ${record.catalogModelId}.`
    );
  }
  const modelTopology = JSON.parse(record.modelTopologyJson) as Record<string, unknown>;
  const weightSpecs = JSON.parse(record.weightSpecsJson) as tf.io.WeightsManifestEntry[];
  const weightData = base64ToArrayBuffer(record.weightDataBase64);
  return tf.loadGraphModel(tf.io.fromMemory({ modelTopology, weightSpecs, weightData }));
}
