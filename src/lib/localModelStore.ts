import * as tf from '@tensorflow/tfjs';
import type { EvaluationReport, TrainedModel } from '../types/domain.ts';

const DB_NAME = 'mk_ai_models_v1';
const DB_VERSION = 1;
const STORE_NAME = 'model_artifacts';

export interface StoredModelArtifact {
  key: string; // modelId or "ckpt_<runId>"
  projectId: string;
  runId: string;
  classes: string[];
  inputSize: number;
  taskType: 'image_classification' | 'object_detection';
  architecture: string;
  modelTopology: unknown;
  weightSpecs: tf.io.WeightsManifestEntry[];
  weightData: ArrayBuffer;
  sizeBytes: number;
  savedAt: string;
}

function openModelDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function normalizeWeightBuffer(weightData: tf.io.WeightData | undefined): ArrayBuffer {
  if (!weightData) return new ArrayBuffer(0);
  if (weightData instanceof ArrayBuffer) return weightData;
  if (Array.isArray(weightData)) {
    const total = weightData.reduce((acc, buf) => acc + buf.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const buf of weightData) {
      out.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    return out.buffer;
  }
  return new ArrayBuffer(0);
}

export async function saveTfModelToIndexedDb(params: {
  key: string;
  projectId: string;
  runId: string;
  classes: string[];
  inputSize: number;
  taskType: 'image_classification' | 'object_detection';
  architecture: string;
  model: tf.LayersModel;
}): Promise<{ sizeBytes: number }> {
  let capturedSize = 0;

  await params.model.save(
    tf.io.withSaveHandler(async (artifacts: tf.io.ModelArtifacts) => {
      const buffer = normalizeWeightBuffer(artifacts.weightData);
      capturedSize = buffer.byteLength;
      const record: StoredModelArtifact = {
        key: params.key,
        projectId: params.projectId,
        runId: params.runId,
        classes: params.classes,
        inputSize: params.inputSize,
        taskType: params.taskType,
        architecture: params.architecture,
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs || [],
        weightData: buffer,
        sizeBytes: buffer.byteLength,
        savedAt: new Date().toISOString(),
      };

      const db = await openModelDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON',
          weightDataBytes: buffer.byteLength,
        },
      };
    })
  );

  return { sizeBytes: capturedSize };
}

export async function getStoredModelRecord(key: string): Promise<StoredModelArtifact | null> {
  const db = await openModelDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as StoredModelArtifact) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function loadTfModelFromIndexedDb(key: string): Promise<{
  model: tf.LayersModel;
  record: StoredModelArtifact;
} | null> {
  const record = await getStoredModelRecord(key);
  if (!record) return null;

  const model = await tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: record.modelTopology as Record<string, unknown>,
      weightSpecs: record.weightSpecs,
      weightData: record.weightData,
    })
  );
  return { model, record };
}

export async function deleteStoredModelRecord(key: string): Promise<void> {
  const db = await openModelDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportStoredModelArtifacts(key: string): Promise<{
  manifestJson: string;
  weightsBlob: Blob;
  filenameBase: string;
} | null> {
  const record = await getStoredModelRecord(key);
  if (!record) return null;

  const manifest = {
    platform: 'MK AI — by MK Tech',
    architecture: record.architecture,
    taskType: record.taskType,
    inputSize: record.inputSize,
    classes: record.classes,
    savedAt: record.savedAt,
    modelTopology: record.modelTopology,
    weightsManifest: [
      {
        paths: [`${record.key}.weights.bin`],
        weights: record.weightSpecs,
      },
    ],
  };

  return {
    manifestJson: JSON.stringify(manifest, null, 2),
    weightsBlob: new Blob([record.weightData], { type: 'application/octet-stream' }),
    filenameBase: `${record.architecture}_${record.key}`,
  };
}

export async function listStoredModelKeys(): Promise<Set<string>> {
  if (typeof indexedDB === 'undefined') return new Set();
  const db = await openModelDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => {
      const keys = Array.isArray(req.result) ? req.result.map((k) => String(k)) : [];
      resolve(new Set(keys));
    };
    req.onerror = () => reject(req.error);
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export async function exportPortableMkModelBundle(model: TrainedModel): Promise<{
  bundleJson: string;
  filename: string;
} | null> {
  const record = await getStoredModelRecord(model.id);
  if (!record) return null;

  const bundle = {
    format: 'mk-ai-model-bundle/v1',
    platform: 'MK AI — by MK Tech',
    exportedAt: new Date().toISOString(),
    modelMeta: {
      id: model.id,
      runId: model.runId,
      name: model.name,
      taskType: model.taskType,
      backendEngine: model.backendEngine,
      architecture: model.architecture,
      license: model.license,
      classes: model.classes,
      inputSize: model.inputSize,
      parameterCount: model.parameterCount,
      weightSizeBytes: model.weightSizeBytes,
      datasetVersion: model.datasetVersion,
      onDeviceCompatible: model.onDeviceCompatible,
      metrics: {
        accuracy: model.accuracy,
        precision: model.precision,
        recall: model.recall,
        f1Score: model.f1Score,
        mAP50: model.mAP50,
        inferenceLatencyMs: model.inferenceLatencyMs,
      },
    },
    preprocessing: {
      colorSpace: 'RGB',
      resize: [model.inputSize, model.inputSize],
      normalization: 'divide_by_255_[0..1]',
      gridSize: model.taskType === 'object_detection' ? 5 : null,
    },
    modelTopology: record.modelTopology,
    weightSpecs: record.weightSpecs,
    weightDataBase64: arrayBufferToBase64(record.weightData),
  };

  return {
    bundleJson: JSON.stringify(bundle, null, 2),
    filename: `${model.architecture}_${model.id}.mkmodel.json`,
  };
}

function escapeCsvCell(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateModelCardReport(
  model: TrainedModel,
  latestReport?: EvaluationReport | null
): { json: string; csv: string } {
  const payload = {
    platform: 'MK AI — by MK Tech',
    generatedAt: new Date().toISOString(),
    model: {
      id: model.id,
      name: model.name,
      taskType: model.taskType,
      architecture: model.architecture,
      backendEngine: model.backendEngine,
      license: model.license,
      datasetId: model.datasetId,
      datasetVersion: model.datasetVersion,
      inputSize: model.inputSize,
      parameterCount: model.parameterCount,
      weightSizeBytes: model.weightSizeBytes,
      onDeviceCompatible: model.onDeviceCompatible,
      classes: model.classes,
    },
    evaluation: latestReport
      ? {
          reportId: latestReport.id,
          split: latestReport.split,
          sampleCount: latestReport.sampleCount,
          confidenceThreshold: latestReport.confidenceThreshold,
          iouThreshold: latestReport.iouThreshold,
          accuracy: latestReport.accuracy,
          precision: latestReport.precision,
          recall: latestReport.recall,
          f1Score: latestReport.f1Score,
          mAP50: latestReport.mAP50,
          avgLatencyMs: latestReport.avgLatencyMs,
          p95LatencyMs: latestReport.p95LatencyMs,
          confusionLabels: latestReport.confusionLabels,
          confusionFlat: latestReport.confusionFlat,
          perClassMetrics: latestReport.perClassMetrics,
        }
      : {
          split: 'test',
          accuracy: model.accuracy,
          precision: model.precision,
          recall: model.recall,
          f1Score: model.f1Score,
          mAP50: model.mAP50,
          avgLatencyMs: model.inferenceLatencyMs,
          confusionLabels: model.confusionLabels,
          confusionFlat: model.confusionFlat,
          perClassMetrics: model.perClassMetrics,
        },
  };

  const rows: string[] = [
    ['Class', 'Precision', 'Recall', 'F1 Score', 'Support'].map(escapeCsvCell).join(','),
  ];
  const perClass = payload.evaluation.perClassMetrics || [];
  for (const row of perClass) {
    rows.push(
      [row.className, row.precision, row.recall, row.f1Score, row.support]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  rows.push('');
  rows.push(
    [
      'SUMMARY',
      `Accuracy=${payload.evaluation.accuracy}`,
      `Precision=${payload.evaluation.precision}`,
      `Recall=${payload.evaluation.recall}`,
      `F1=${payload.evaluation.f1Score}`,
      `mAP50=${payload.evaluation.mAP50}`,
      `LatencyMs=${payload.evaluation.avgLatencyMs}`,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return {
    json: JSON.stringify(payload, null, 2),
    csv: rows.join('\n'),
  };
}

export function generateIntegrationSnippets(model: TrainedModel): {
  browserTs: string;
  pythonPy: string;
} {
  const classesLiteral = JSON.stringify(model.classes);
  const browserTs = `// MK AI by MK Tech — TensorFlow.js Browser Inference Starter
import * as tf from '@tensorflow/tfjs';

export const MODEL_CLASSES = ${classesLiteral};
export const INPUT_SIZE = ${model.inputSize};
export const TASK_TYPE = '${model.taskType}';

export async function runMkAiInference(modelUrl: string, imageEl: HTMLImageElement | HTMLCanvasElement) {
  const model = await tf.loadLayersModel(modelUrl);
  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    const sw = imageEl instanceof HTMLImageElement ? imageEl.naturalWidth || imageEl.width : imageEl.width;
    const sh = imageEl instanceof HTMLImageElement ? imageEl.naturalHeight || imageEl.height : imageEl.height;
    const scale = Math.min(INPUT_SIZE / Math.max(1, sw), INPUT_SIZE / Math.max(1, sh));
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(imageEl, (INPUT_SIZE - dw) / 2, (INPUT_SIZE - dh) / 2, dw, dh);
  }
  const input = tf.tidy(() => {
    return tf.browser
      .fromPixels(canvas)
      .toFloat()
      .div(255.0)
      .expandDims(0);
  });
  const output = model.predict(input) as tf.Tensor;
  const data = await output.data();
  input.dispose();
  output.dispose();
  return { classes: MODEL_CLASSES, rawOutput: Array.from(data) };
}
`;

  const pythonPy = `# MK AI by MK Tech — Python Inference Starter (${model.architecture})
import json
from pathlib import Path
from PIL import Image
import numpy as np

CLASSES = ${classesLiteral}
INPUT_SIZE = ${model.inputSize}
TASK_TYPE = "${model.taskType}"

def preprocess_image(image_path: str) -> np.ndarray:
    img = Image.open(image_path).convert("RGB").resize((INPUT_SIZE, INPUT_SIZE))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.expand_dims(arr, axis=0)

# Load weights exported from MK AI Model Hub (.pt for PyTorch/YOLO or .mkmodel.json)
print(f"Loaded spec for {TASK_TYPE} with {len(CLASSES)} classes: {CLASSES}")
`;

  return { browserTs, pythonPy };
}
