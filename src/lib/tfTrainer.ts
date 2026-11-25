import * as tf from '@tensorflow/tfjs';
import {
  renderPreprocessedCanvas,
  validateDatasetForTraining,
} from './datasetUtils.ts';
import { getMediaBlob, listStoredDatasetBlobIds } from './localMediaStore.ts';
import { saveTfModelToIndexedDb } from './localModelStore.ts';
import type {
  BatchEvalSampleResult,
  BatchEvaluationResult,
  BoundingBox,
  Dataset,
  DatasetItem,
  EpochMetricPoint,
  EvaluationSplitTarget,
  InferencePrediction,
  ModelArchitectureSpec,
  OptimizerType,
  PerClassMetric,
  SanityTestResult,
  TrainingDiagnostics,
  TrainingHyperparameters,
  V1TaskType,
} from '../types/domain.ts';

export const MODEL_ARCHITECTURES: ModelArchitectureSpec[] = [
  {
    id: 'mk_mobilenet_sep',
    name: 'MK Mobile-Depthwise CNN (TF.js)',
    taskType: 'image_classification',
    backendEngine: 'tfjs_browser',
    license: 'Apache-2.0 (In-Browser)',
    recommendedInputSize: 96,
    onDeviceCompatible: true,
    summaryEn: 'Depthwise-separable convolutional network trained locally in WebGL/CPU. Mobile & offline PWA ready.',
    summaryAr: 'شبكة تلافيفية خفيفة (Depthwise-Separable) تتدرب محلياً عبر WebGL/CPU ومناسبة لتطبيقات الموبايل والأوفلاين.',
  },
  {
    id: 'mk_convnet_deep',
    name: 'MK Multi-Stage ConvNet (TF.js)',
    taskType: 'image_classification',
    backendEngine: 'tfjs_browser',
    license: 'Apache-2.0 (In-Browser)',
    recommendedInputSize: 128,
    onDeviceCompatible: true,
    summaryEn: '3-stage convolutional feature extractor with BatchNorm and Dropout trained directly on your device.',
    summaryAr: 'شبكة تلافيفية متعددة المراحل مع BatchNorm و Dropout تتدرب مباشرة على جهازك بدون إرسال الصور.',
  },
  {
    id: 'mobilenet_v3_large',
    name: 'MobileNetV3-Large (PyTorch)',
    taskType: 'image_classification',
    backendEngine: 'python_fastapi',
    license: 'BSD-3-Clause (torchvision)',
    recommendedInputSize: 224,
    onDeviceCompatible: true,
    summaryEn: 'Server-side PyTorch MobileNetV3-Large worker (requires connected Python AI Engine).',
    summaryAr: 'نموذج MobileNetV3-Large عبر خادم PyTorch (يتطلب اتصال خدمة Python AI Engine).',
  },
  {
    id: 'efficientnet_b0',
    name: 'EfficientNet-B0 (PyTorch)',
    taskType: 'image_classification',
    backendEngine: 'python_fastapi',
    license: 'BSD-3-Clause (torchvision)',
    recommendedInputSize: 224,
    onDeviceCompatible: true,
    summaryEn: 'High-accuracy EfficientNet-B0 classifier on Python GPU/CPU worker.',
    summaryAr: 'نموذج EfficientNet-B0 عالي الدقة على خادم Python GPU/CPU.',
  },
  {
    id: 'mk_yolo_grid',
    name: 'MK Grid-YOLO Detector (TF.js)',
    taskType: 'object_detection',
    backendEngine: 'tfjs_browser',
    license: 'Apache-2.0 (In-Browser)',
    recommendedInputSize: 128,
    onDeviceCompatible: true,
    summaryEn: 'Spatial 5×5 grid object detector predicting bounding boxes, objectness, and classes locally in WebGL/CPU.',
    summaryAr: 'كاشف عناصر شبكي 5×5 يتعلم إحداثيات الصناديق والفئات محلياً على جهازك عبر WebGL/CPU.',
  },
  {
    id: 'yolo11n',
    name: 'YOLO11n (Ultralytics Python)',
    taskType: 'object_detection',
    backendEngine: 'python_fastapi',
    license: 'AGPL-3.0 (Ultralytics)',
    recommendedInputSize: 640,
    onDeviceCompatible: true,
    summaryEn: 'Ultralytics YOLO11 nano real-time detector via connected Python AI Engine.',
    summaryAr: 'نموذج YOLO11n فائق السرعة عبر خادم Python AI Engine المتصل.',
  },
  {
    id: 'yolov8n',
    name: 'YOLOv8n (Ultralytics Python)',
    taskType: 'object_detection',
    backendEngine: 'python_fastapi',
    license: 'AGPL-3.0 (Ultralytics)',
    recommendedInputSize: 640,
    onDeviceCompatible: true,
    summaryEn: 'Ultralytics YOLOv8 nano detector via connected Python AI Engine.',
    summaryAr: 'نموذج YOLOv8n عبر خادم Python AI Engine المتصل.',
  },
  {
    id: 'fasterrcnn_mobilenet_v3',
    name: 'Faster R-CNN MobileNetV3 (PyTorch)',
    taskType: 'object_detection',
    backendEngine: 'python_fastapi',
    license: 'BSD-3-Clause (torchvision)',
    recommendedInputSize: 320,
    onDeviceCompatible: false,
    summaryEn: 'Two-stage precision detector executed on server PyTorch GPU/CPU worker.',
    summaryAr: 'كاشف ثنائي المراحل عالي الدقة يُنفذ عبر خادم PyTorch GPU/CPU.',
  },
];

export function getRecommendedHyperparameters(
  taskType: V1TaskType,
  sampleCount: number
): TrainingHyperparameters {
  const batchSize = sampleCount >= 24 ? 8 : sampleCount >= 8 ? 4 : 2;
  return {
    epochs: taskType === 'image_classification' ? 18 : 20,
    batchSize,
    learningRate: taskType === 'image_classification' ? 0.001 : 0.0018,
    optimizer: 'adam',
    inputSize: taskType === 'image_classification' ? 96 : 128,
    confidenceThreshold: 0.35,
    iouThreshold: 0.5,
    earlyStoppingPatience: 6,
    saveCheckpoints: true,
  };
}

export function createOptimizer(name: OptimizerType, lr: number): tf.Optimizer {
  if (name === 'sgd') return tf.train.sgd(lr);
  if (name === 'rmsprop') return tf.train.rmsprop(lr);
  return tf.train.adam(lr);
}

export function buildClassificationModel(
  architecture: string,
  inputSize: number,
  numClasses: number
): tf.LayersModel {
  const model = tf.sequential();

  if (architecture === 'mk_convnet_deep') {
    model.add(
      tf.layers.conv2d({
        inputShape: [inputSize, inputSize, 3],
        filters: 24,
        kernelSize: 3,
        padding: 'same',
        activation: 'relu',
        kernelInitializer: 'heNormal',
      })
    );
    model.add(
      tf.layers.conv2d({
        filters: 24,
        kernelSize: 3,
        padding: 'same',
        activation: 'relu',
        kernelInitializer: 'heNormal',
      })
    );
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

    model.add(
      tf.layers.conv2d({
        filters: 32,
        kernelSize: 3,
        padding: 'same',
        activation: 'relu',
        kernelInitializer: 'heNormal',
      })
    );
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

    model.add(
      tf.layers.conv2d({
        filters: 48,
        kernelSize: 3,
        padding: 'same',
        activation: 'relu',
        kernelInitializer: 'heNormal',
      })
    );
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

    if (inputSize >= 64) {
      model.add(
        tf.layers.conv2d({
          filters: 48,
          kernelSize: 3,
          padding: 'same',
          activation: 'relu',
          kernelInitializer: 'heNormal',
        })
      );
      model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
    }
    if (inputSize >= 120) {
      model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
    }

    model.add(tf.layers.flatten());
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(
      tf.layers.dense({
        units: 48,
        activation: 'relu',
        kernelInitializer: 'heNormal',
      })
    );
    model.add(
      tf.layers.dense({
        units: numClasses,
        activation: 'softmax',
        kernelInitializer: 'glorotNormal',
      })
    );
    return model;
  }

  // Default: mk_mobilenet_sep (Spatial Depthwise-Separable CNN without tiny-batch BN drift)
  model.add(
    tf.layers.conv2d({
      inputShape: [inputSize, inputSize, 3],
      filters: 16,
      kernelSize: 3,
      strides: 2,
      padding: 'same',
      activation: 'relu',
      kernelInitializer: 'heNormal',
    })
  );

  model.add(
    tf.layers.separableConv2d({
      filters: 32,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
      depthwiseInitializer: 'heNormal',
      pointwiseInitializer: 'heNormal',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.separableConv2d({
      filters: 48,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
      depthwiseInitializer: 'heNormal',
      pointwiseInitializer: 'heNormal',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  if (inputSize >= 64) {
    model.add(
      tf.layers.separableConv2d({
        filters: 64,
        kernelSize: 3,
        padding: 'same',
        activation: 'relu',
        depthwiseInitializer: 'heNormal',
        pointwiseInitializer: 'heNormal',
      })
    );
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
  }
  if (inputSize >= 120) {
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
  }

  model.add(tf.layers.flatten());
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(
    tf.layers.dense({
      units: 32,
      activation: 'relu',
      kernelInitializer: 'heNormal',
    })
  );
  model.add(
    tf.layers.dense({
      units: numClasses,
      activation: 'softmax',
      kernelInitializer: 'glorotNormal',
    })
  );
  return model;
}

export const DETECTION_GRID_SIZE = 5;

export function buildGridYoloModel(
  inputSize: number,
  numClasses: number,
  gridSize: number = DETECTION_GRID_SIZE
): tf.LayersModel {
  const model = tf.sequential();
  model.add(
    tf.layers.conv2d({
      inputShape: [inputSize, inputSize, 3],
      filters: 16,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
      kernelInitializer: 'heNormal',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.conv2d({
      filters: 32,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
      kernelInitializer: 'heNormal',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.conv2d({
      filters: 48,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
      kernelInitializer: 'heNormal',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.conv2d({
      filters: 48,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
      kernelInitializer: 'heNormal',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  if (inputSize >= 128) {
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
  }

  model.add(tf.layers.flatten());
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(
    tf.layers.dense({
      units: gridSize * gridSize * (5 + numClasses),
      kernelInitializer: 'glorotNormal',
    })
  );
  model.add(
    tf.layers.reshape({
      targetShape: [gridSize, gridSize, 5 + numClasses],
    })
  );
  return model;
}

export interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeIoU(a: BoxRect, b: BoxRect): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const intersection = iw * ih;
  if (intersection <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function computeClassificationMetrics(
  yTrue: number[],
  yPred: number[],
  classes: string[]
): {
  accuracy: number;
  errorRate: number;
  precision: number;
  recall: number;
  f1Score: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
} {
  const k = classes.length;
  const matrix = new Array(k * k).fill(0);
  let correct = 0;

  for (let i = 0; i < yTrue.length; i++) {
    const t = yTrue[i];
    const p = yPred[i];
    if (t >= 0 && t < k && p >= 0 && p < k) {
      matrix[t * k + p] += 1;
      if (t === p) correct += 1;
    }
  }

  const perClassMetrics: PerClassMetric[] = classes.map((className, c) => {
    const tp = matrix[c * k + c];
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (let i = 0; i < k; i++) {
      support += matrix[c * k + i];
      if (i !== c) {
        fp += matrix[i * k + c];
        fn += matrix[c * k + i];
      }
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return {
      className,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1Score: Number(f1Score.toFixed(4)),
      support,
    };
  });

  const active = perClassMetrics.filter((m) => m.support > 0);
  const denom = active.length || 1;
  const macroP = active.reduce((s, m) => s + m.precision, 0) / denom;
  const macroR = active.reduce((s, m) => s + m.recall, 0) / denom;
  const macroF1 = active.reduce((s, m) => s + m.f1Score, 0) / denom;
  const accuracy = yTrue.length > 0 ? correct / yTrue.length : 0;
  const errorRate = Math.max(0, 1 - accuracy);

  return {
    accuracy: Number(accuracy.toFixed(4)),
    errorRate: Number(errorRate.toFixed(4)),
    precision: Number(macroP.toFixed(4)),
    recall: Number(macroR.toFixed(4)),
    f1Score: Number(macroF1.toFixed(4)),
    confusionLabels: [...classes],
    confusionFlat: matrix,
    perClassMetrics,
  };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));
}

function softmaxArray(logits: number[]): number[] {
  const maxVal = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - maxVal));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

export interface DetectedBox {
  className: string;
  classIndex: number;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function decodeGridDetections(
  rawGrid: Float32Array | number[],
  classes: string[],
  gridSize: number,
  confThreshold: number,
  iouThreshold: number
): DetectedBox[] {
  const stride = 5 + classes.length;
  const candidates: DetectedBox[] = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const base = (row * gridSize + col) * stride;
      const objProb = sigmoid(rawGrid[base + 4]);
      if (objProb < confThreshold * 0.5) continue;

      const cx = (col + sigmoid(rawGrid[base + 0])) / gridSize;
      const cy = (row + sigmoid(rawGrid[base + 1])) / gridSize;
      const w = Math.min(1, Math.max(0.02, sigmoid(rawGrid[base + 2])));
      const h = Math.min(1, Math.max(0.02, sigmoid(rawGrid[base + 3])));

      const classLogits: number[] = [];
      for (let c = 0; c < classes.length; c++) {
        classLogits.push(rawGrid[base + 5 + c]);
      }
      const probs = softmaxArray(classLogits);
      let bestC = 0;
      let bestP = probs[0] ?? 0;
      for (let c = 1; c < probs.length; c++) {
        if (probs[c] > bestP) {
          bestP = probs[c];
          bestC = c;
        }
      }

      const confidence = objProb * bestP;
      if (confidence >= confThreshold) {
        const x = Math.max(0, Math.min(1 - 0.01, cx - w / 2));
        const y = Math.max(0, Math.min(1 - 0.01, cy - h / 2));
        candidates.push({
          className: classes[bestC],
          classIndex: bestC,
          confidence: Number(confidence.toFixed(4)),
          x,
          y,
          width: Math.min(1 - x, w),
          height: Math.min(1 - y, h),
        });
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const kept: DetectedBox[] = [];
  for (const cand of candidates) {
    const suppressed = kept.some(
      (k) => k.classIndex === cand.classIndex && computeIoU(k, cand) > iouThreshold
    );
    if (!suppressed) kept.push(cand);
  }
  return kept.slice(0, 30);
}

export function encodeGridTargets(
  boxesList: BoundingBox[][],
  classes: string[],
  gridSize: number
): tf.Tensor4D {
  const n = boxesList.length;
  const depth = 5 + classes.length;
  const buf = new Float32Array(n * gridSize * gridSize * depth);

  for (let i = 0; i < n; i++) {
    for (const box of boxesList[i]) {
      const cIdx = classes.indexOf(box.className);
      if (cIdx < 0) continue;
      const cx = Math.min(0.999, Math.max(0.001, box.x + box.width / 2));
      const cy = Math.min(0.999, Math.max(0.001, box.y + box.height / 2));
      const col = Math.min(gridSize - 1, Math.floor(cx * gridSize));
      const row = Math.min(gridSize - 1, Math.floor(cy * gridSize));
      const cellOffsetX = cx * gridSize - col;
      const cellOffsetY = cy * gridSize - row;
      const base = ((i * gridSize + row) * gridSize + col) * depth;

      buf[base + 0] = cellOffsetX;
      buf[base + 1] = cellOffsetY;
      buf[base + 2] = Math.min(1, Math.max(0.02, box.width));
      buf[base + 3] = Math.min(1, Math.max(0.02, box.height));
      buf[base + 4] = 1;
      buf[base + 5 + cIdx] = 1;
    }
  }
  return tf.tensor4d(buf, [n, gridSize, gridSize, depth]);
}

function computeMapAtSingleIoU(
  groundTruthPerImage: BoundingBox[][],
  predictionsPerImage: DetectedBox[][],
  classes: string[],
  iouThreshold: number
): {
  precision: number;
  recall: number;
  f1Score: number;
  mAP: number;
  meanIoU: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
} {
  const k = classes.length;
  const labelsWithBg = [...classes, '__background__'];
  const mSize = labelsWithBg.length;
  const matrix = new Array(mSize * mSize).fill(0);

  const tpByClass = new Array(k).fill(0);
  const fpByClass = new Array(k).fill(0);
  const fnByClass = new Array(k).fill(0);
  const supportByClass = new Array(k).fill(0);
  const predsScoresByClass: { conf: number; tp: boolean }[][] = classes.map(() => []);
  let matchedIoUSum = 0;
  let matchedIoUCount = 0;

  for (let imgIdx = 0; imgIdx < groundTruthPerImage.length; imgIdx++) {
    const gts = groundTruthPerImage[imgIdx] || [];
    const preds = [...(predictionsPerImage[imgIdx] || [])].sort(
      (a, b) => b.confidence - a.confidence
    );
    const matchedGt = new Set<number>();

    for (const gt of gts) {
      const cIdx = classes.indexOf(gt.className);
      if (cIdx >= 0) supportByClass[cIdx] += 1;
    }

    for (const pred of preds) {
      let bestGtIdx = -1;
      let bestIoU = 0;
      for (let g = 0; g < gts.length; g++) {
        if (matchedGt.has(g)) continue;
        const iou = computeIoU(pred, gts[g]);
        if (iou >= iouThreshold && iou > bestIoU) {
          bestIoU = iou;
          bestGtIdx = g;
        }
      }

      if (bestGtIdx >= 0) {
        matchedGt.add(bestGtIdx);
        const gtClassIdx = classes.indexOf(gts[bestGtIdx].className);
        if (gtClassIdx >= 0 && pred.classIndex >= 0 && pred.classIndex < k) {
          matrix[gtClassIdx * mSize + pred.classIndex] += 1;
        }
        if (pred.classIndex === gtClassIdx) {
          tpByClass[pred.classIndex] += 1;
          matchedIoUSum += bestIoU;
          matchedIoUCount += 1;
          predsScoresByClass[pred.classIndex].push({ conf: pred.confidence, tp: true });
        } else if (pred.classIndex >= 0 && pred.classIndex < k) {
          fpByClass[pred.classIndex] += 1;
          predsScoresByClass[pred.classIndex].push({ conf: pred.confidence, tp: false });
        }
      } else if (pred.classIndex >= 0 && pred.classIndex < k) {
        fpByClass[pred.classIndex] += 1;
        matrix[k * mSize + pred.classIndex] += 1;
        predsScoresByClass[pred.classIndex].push({ conf: pred.confidence, tp: false });
      }
    }

    for (let g = 0; g < gts.length; g++) {
      if (!matchedGt.has(g)) {
        const cIdx = classes.indexOf(gts[g].className);
        if (cIdx >= 0) {
          fnByClass[cIdx] += 1;
          matrix[cIdx * mSize + k] += 1;
        }
      }
    }
  }

  let apSum = 0;
  let activeClasses = 0;
  const perClassMetrics: PerClassMetric[] = classes.map((className, c) => {
    const tp = tpByClass[c];
    const fp = fpByClass[c];
    const fn = fnByClass[c];
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    if (supportByClass[c] > 0) {
      activeClasses += 1;
      const sorted = [...predsScoresByClass[c]].sort((a, b) => b.conf - a.conf);
      let cumTp = 0;
      let cumFp = 0;
      let prevRecall = 0;
      let ap = 0;
      for (const row of sorted) {
        if (row.tp) cumTp += 1;
        else cumFp += 1;
        const p = cumTp / (cumTp + cumFp);
        const r = cumTp / supportByClass[c];
        ap += p * Math.max(0, r - prevRecall);
        prevRecall = r;
      }
      apSum += ap;
    }

    return {
      className,
      precision: Number(precision.toFixed(4)),
      recall: Number(recall.toFixed(4)),
      f1Score: Number(f1Score.toFixed(4)),
      support: supportByClass[c],
    };
  });

  const active = perClassMetrics.filter((m) => m.support > 0);
  const denom = active.length || 1;
  const macroP = active.reduce((s, m) => s + m.precision, 0) / denom;
  const macroR = active.reduce((s, m) => s + m.recall, 0) / denom;
  const macroF1 = active.reduce((s, m) => s + m.f1Score, 0) / denom;
  const mAP = activeClasses > 0 ? apSum / activeClasses : 0;
  const meanIoU = matchedIoUCount > 0 ? matchedIoUSum / matchedIoUCount : 0;

  return {
    precision: Number(macroP.toFixed(4)),
    recall: Number(macroR.toFixed(4)),
    f1Score: Number(macroF1.toFixed(4)),
    mAP: Number(mAP.toFixed(4)),
    meanIoU: Number(meanIoU.toFixed(4)),
    confusionLabels: labelsWithBg,
    confusionFlat: matrix,
    perClassMetrics,
  };
}

export function computeDetectionMetrics(
  groundTruthPerImage: BoundingBox[][],
  predictionsPerImage: DetectedBox[][],
  classes: string[],
  iouThreshold: number = 0.5
): {
  precision: number;
  recall: number;
  f1Score: number;
  mAP50: number;
  mAP50_95: number;
  meanIoU: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
} {
  const primary = computeMapAtSingleIoU(
    groundTruthPerImage,
    predictionsPerImage,
    classes,
    iouThreshold
  );

  const cocoThresholds = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
  let sumMap = 0;
  for (const thr of cocoThresholds) {
    sumMap += computeMapAtSingleIoU(
      groundTruthPerImage,
      predictionsPerImage,
      classes,
      thr
    ).mAP;
  }
  const mAP50_95 = Number((sumMap / cocoThresholds.length).toFixed(4));

  return {
    precision: primary.precision,
    recall: primary.recall,
    f1Score: primary.f1Score,
    mAP50: primary.mAP,
    mAP50_95,
    meanIoU: primary.meanIoU,
    confusionLabels: primary.confusionLabels,
    confusionFlat: primary.confusionFlat,
    perClassMetrics: primary.perClassMetrics,
  };
}

export interface TrainingControlHooks {
  shouldPause: () => boolean;
  shouldCancel: () => boolean;
  onEpoch: (point: EpochMetricPoint, bestEpoch: number, bestValMetric: number) => Promise<void> | void;
  onLog: (line: string) => void;
  onSaveCheckpoint?: (model: tf.LayersModel, epoch: number) => Promise<void>;
}

async function waitWhilePaused(hooks: TrainingControlHooks): Promise<'continue' | 'cancel'> {
  while (hooks.shouldPause()) {
    if (hooks.shouldCancel()) return 'cancel';
    await new Promise((r) => setTimeout(r, 200));
  }
  return hooks.shouldCancel() ? 'cancel' : 'continue';
}

function measureWeightL1Delta(prevSnapshot: Float32Array[], model: tf.LayersModel): number {
  const curr = model.getWeights();
  let delta = 0;
  for (let i = 0; i < curr.length; i++) {
    const p = prevSnapshot[i];
    const c = curr[i].dataSync() as Float32Array;
    if (!p || p.length !== c.length) continue;
    for (let j = 0; j < c.length; j++) {
      delta += Math.abs(c[j] - p[j]);
    }
  }
  return delta;
}

function captureWeightSnapshot(model: tf.LayersModel): Float32Array[] {
  return model.getWeights().map((w) => new Float32Array(w.dataSync() as Float32Array));
}

function computeClassifierGradNorm(
  model: tf.LayersModel,
  xSample: tf.Tensor4D,
  yOneHotSample: tf.Tensor2D
): { lossValue: number; gradL1Norm: number } {
  const trainableVars = model.trainableWeights.map((w) => w.read() as tf.Variable);
  return tf.tidy(() => {
    const { value, grads } = tf.variableGrads(() => {
      const probs = model.apply(xSample, { training: true }) as tf.Tensor2D;
      const clipped = tf.clipByValue(probs, 1e-7, 1 - 1e-7);
      return tf.neg(tf.mean(tf.sum(tf.mul(yOneHotSample, tf.log(clipped)), 1))) as tf.Scalar;
    }, trainableVars);
    let gradNorm = 0;
    for (const g of Object.values(grads)) {
      gradNorm += Number(tf.sum(tf.abs(g)).dataSync()[0] ?? 0);
    }
    return {
      lossValue: Number(value.dataSync()[0] ?? Number.NaN),
      gradL1Norm: gradNorm,
    };
  });
}

function computeBalancedClassWeights(yOneHot: tf.Tensor2D, numClasses: number): { [k: number]: number } | undefined {
  const indices = tf.tidy(() => Array.from(yOneHot.argMax(1).dataSync()));
  if (indices.length === 0) return undefined;
  const counts = new Array(numClasses).fill(0);
  for (const idx of indices) {
    if (idx >= 0 && idx < numClasses) counts[idx] += 1;
  }
  const positive = counts.filter((c) => c > 0);
  if (positive.length < 2) return undefined;
  const maxC = Math.max(...positive);
  const minC = Math.min(...positive);
  if (maxC / minC < 1.5) return undefined;
  const weights: { [k: number]: number } = {};
  for (let c = 0; c < numClasses; c++) {
    const count = Math.max(1, counts[c]);
    weights[c] = Number(Math.min(4, Math.max(0.5, indices.length / (numClasses * count))).toFixed(4));
  }
  return weights;
}

export async function trainClassifierCore(params: {
  model: tf.LayersModel;
  xTrain: tf.Tensor4D;
  yTrainOneHot: tf.Tensor2D;
  xVal: tf.Tensor4D;
  yValOneHot: tf.Tensor2D;
  yValIndices: number[];
  classes: string[];
  hyperparameters: TrainingHyperparameters;
  hooks: TrainingControlHooks;
}): Promise<{
  status: 'completed' | 'cancelled';
  epochMetrics: EpochMetricPoint[];
  bestEpoch: number;
  bestValMetric: number;
  diagnostics: TrainingDiagnostics;
}> {
  const { model, xTrain, yTrainOneHot, xVal, yValOneHot, yValIndices, classes, hyperparameters, hooks } =
    params;

  if (model.trainableWeights.length === 0) {
    throw new Error('Model has zero trainable parameters.');
  }
  if (xTrain.shape[0] < 1 || yTrainOneHot.shape[1] !== classes.length) {
    throw new Error(`Tensor dimension mismatch: expected [N, ${classes.length}] targets.`);
  }

  const optimizer = createOptimizer(hyperparameters.optimizer, hyperparameters.learningRate);
  model.compile({
    optimizer,
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  // Step-0 Gradient & Finite Loss Diagnostic Check
  const probeCount = Math.min(4, xTrain.shape[0]);
  const probeCheck = tf.tidy(() => {
    const xProbe = xTrain.slice([0, 0, 0, 0], [probeCount, -1, -1, -1]) as tf.Tensor4D;
    const yProbe = yTrainOneHot.slice([0, 0], [probeCount, -1]) as tf.Tensor2D;
    return computeClassifierGradNorm(model, xProbe, yProbe);
  });

  if (!Number.isFinite(probeCheck.lossValue)) {
    throw new Error('Diagnostic failure: Initial forward pass produced NaN/Infinity loss.');
  }
  if (!(probeCheck.gradL1Norm > 0)) {
    throw new Error('Diagnostic failure: Initial backpropagation produced zero gradients across all trainable layers.');
  }
  hooks.onLog(
    `[Diagnostic] Trainable params: ${model.countParams().toLocaleString()} · Initial loss: ${probeCheck.lossValue.toFixed(4)} · Grad L1: ${probeCheck.gradL1Norm.toFixed(4)}`
  );

  const classWeight = computeBalancedClassWeights(yTrainOneHot, classes.length);
  if (classWeight) {
    hooks.onLog(`[Diagnostic] Class imbalance balancing weights enabled.`);
  }

  const epochMetrics: EpochMetricPoint[] = [];
  let bestEpoch = 0;
  let bestValMetric = -1;
  let bestValLoss = Number.POSITIVE_INFINITY;
  let staleEpochs = 0;
  let bestWeights: tf.Tensor[] | null = null;
  let epoch1ParamDelta = 0;
  let allLossesFinite = true;

  for (let epoch = 1; epoch <= hyperparameters.epochs; epoch++) {
    const gate = await waitWhilePaused(hooks);
    if (gate === 'cancel') {
      bestWeights?.forEach((w) => w.dispose());
      return {
        status: 'cancelled',
        epochMetrics,
        bestEpoch: Math.max(1, bestEpoch),
        bestValMetric: Math.max(0, bestValMetric),
        diagnostics: {
          trainableParamCount: model.countParams(),
          initialGradientNorm: Number(probeCheck.gradL1Norm.toFixed(6)),
          epoch1ParamDelta: Number(epoch1ParamDelta.toFixed(6)),
          hasNonZeroGradients: probeCheck.gradL1Norm > 0,
          allLossesFinite,
          parametersUpdated: epoch1ParamDelta > 0,
        },
      };
    }

    const beforeSnapshot = epoch === 1 ? captureWeightSnapshot(model) : null;
    const t0 = performance.now();
    const history = await model.fit(xTrain, yTrainOneHot, {
      epochs: 1,
      batchSize: Math.min(hyperparameters.batchSize, xTrain.shape[0]),
      shuffle: true,
      validationData: [xVal, yValOneHot],
      classWeight,
      verbose: 0,
    });

    if (beforeSnapshot) {
      epoch1ParamDelta = measureWeightL1Delta(beforeSnapshot, model);
      if (!(epoch1ParamDelta > 0)) {
        throw new Error('Diagnostic failure: Model weights did not change after Epoch 1 optimizer step (frozen parameters).');
      }
      hooks.onLog(`[Diagnostic] Epoch 1 weight update ΔW L1 = ${epoch1ParamDelta.toFixed(4)}`);
    }

    const trainLoss = Number(history.history.loss?.[0] ?? Number.NaN);
    const valLoss = Number(history.history.val_loss?.[0] ?? trainLoss);
    const trainAcc = Number(history.history.acc?.[0] ?? history.history.accuracy?.[0] ?? 0);

    if (!Number.isFinite(trainLoss) || !Number.isFinite(valLoss)) {
      allLossesFinite = false;
      bestWeights?.forEach((w) => w.dispose());
      throw new Error(`Training diverged at epoch ${epoch}: non-finite loss (${trainLoss} / ${valLoss}).`);
    }

    const valPredIndices = tf.tidy(() => {
      const probs = model.predict(xVal) as tf.Tensor2D;
      return Array.from(probs.argMax(1).dataSync());
    });
    const valStats = computeClassificationMetrics(yValIndices, valPredIndices, classes);
    const valAcc = valStats.accuracy;
    const durationMs = Math.max(1, Math.round(performance.now() - t0));

    const point: EpochMetricPoint = {
      epoch,
      trainLoss: Number(trainLoss.toFixed(5)),
      valLoss: Number(valLoss.toFixed(5)),
      trainMetric: Number(trainAcc.toFixed(4)),
      valMetric: Number(valAcc.toFixed(4)),
      durationMs,
    };
    epochMetrics.push(point);

    const improved =
      valAcc > bestValMetric || (valAcc === bestValMetric && valLoss < bestValLoss);
    if (improved) {
      bestValMetric = valAcc;
      bestValLoss = valLoss;
      bestEpoch = epoch;
      staleEpochs = 0;
      bestWeights?.forEach((w) => w.dispose());
      bestWeights = model.getWeights().map((w) => w.clone());
      if (hyperparameters.saveCheckpoints && hooks.onSaveCheckpoint) {
        await hooks.onSaveCheckpoint(model, epoch);
      }
    } else {
      staleEpochs += 1;
    }

    hooks.onLog(
      `Epoch ${epoch}/${hyperparameters.epochs} — loss: ${point.trainLoss.toFixed(4)} · acc: ${(
        point.trainMetric * 100
      ).toFixed(1)}% · val_loss: ${point.valLoss.toFixed(4)} · val_acc: ${(
        point.valMetric * 100
      ).toFixed(1)}% · val_err: ${(valStats.errorRate * 100).toFixed(1)}% (${durationMs}ms)`
    );
    await hooks.onEpoch(point, bestEpoch, Math.max(0, bestValMetric));

    if (
      hyperparameters.earlyStoppingPatience > 0 &&
      staleEpochs >= hyperparameters.earlyStoppingPatience &&
      epoch >= 8
    ) {
      hooks.onLog(`Early stopping triggered at epoch ${epoch} (best epoch ${bestEpoch}).`);
      break;
    }

    await tf.nextFrame();
  }

  if (bestWeights) {
    model.setWeights(bestWeights);
    bestWeights.forEach((w) => w.dispose());
  }

  return {
    status: 'completed',
    epochMetrics,
    bestEpoch: Math.max(1, bestEpoch),
    bestValMetric: Math.max(0, bestValMetric),
    diagnostics: {
      trainableParamCount: model.countParams(),
      initialGradientNorm: Number(probeCheck.gradL1Norm.toFixed(6)),
      epoch1ParamDelta: Number(epoch1ParamDelta.toFixed(6)),
      hasNonZeroGradients: probeCheck.gradL1Norm > 0,
      allLossesFinite,
      parametersUpdated: epoch1ParamDelta > 0,
    },
  };
}

function computeYoloBatchLoss(
  preds: tf.Tensor4D,
  targets: tf.Tensor4D,
  numClasses: number
): tf.Scalar {
  return tf.tidy(() => {
    const objMask = targets.slice([0, 0, 0, 4], [-1, -1, -1, 1]);
    const negMask = tf.sub(1, objMask);

    const predXY = tf.sigmoid(preds.slice([0, 0, 0, 0], [-1, -1, -1, 2]));
    const predWH = tf.sigmoid(preds.slice([0, 0, 0, 2], [-1, -1, -1, 2]));
    const predObj = tf.sigmoid(preds.slice([0, 0, 0, 4], [-1, -1, -1, 1]));
    const predClsLogits = preds.slice([0, 0, 0, 5], [-1, -1, -1, numClasses]);

    const trueXY = targets.slice([0, 0, 0, 0], [-1, -1, -1, 2]);
    const trueWH = targets.slice([0, 0, 0, 2], [-1, -1, -1, 2]);
    const trueCls = targets.slice([0, 0, 0, 5], [-1, -1, -1, numClasses]);

    const xyLoss = tf.sum(tf.mul(objMask, tf.abs(tf.sub(predXY, trueXY))));
    const whLoss = tf.sum(tf.mul(objMask, tf.abs(tf.sub(predWH, trueWH))));

    const eps = 1e-6;
    const posObjLoss = tf.sum(
      tf.mul(objMask, tf.neg(tf.log(tf.add(predObj, eps))))
    );
    const negObjLoss = tf.sum(
      tf.mul(negMask, tf.neg(tf.log(tf.add(tf.sub(1, predObj), eps))))
    );

    // Strictly mask classification cross-entropy to grid cells that actually contain objects
    const logProbs = tf.logSoftmax(predClsLogits, -1);
    const cellClsCrossEnt = tf.neg(tf.sum(tf.mul(trueCls, logProbs), -1, true));
    const maskedClsLoss = tf.sum(tf.mul(objMask, cellClsCrossEnt));

    const posCount = tf.maximum(1, tf.sum(objMask));
    const negCount = tf.maximum(1, tf.sum(negMask));

    const coordLoss = tf.div(tf.mul(5, tf.add(xyLoss, whLoss)), posCount);
    const objLoss = tf.add(
      tf.div(posObjLoss, posCount),
      tf.mul(0.5, tf.div(negObjLoss, negCount))
    );
    const clsLoss = tf.div(maskedClsLoss, posCount);

    return tf.add(tf.add(coordLoss, objLoss), clsLoss) as tf.Scalar;
  });
}

export async function trainDetectorCore(params: {
  model: tf.LayersModel;
  xTrain: tf.Tensor4D;
  yTrainTargets: tf.Tensor4D;
  trainGroundTruth?: BoundingBox[][];
  xVal: tf.Tensor4D;
  yValTargets: tf.Tensor4D;
  valGroundTruth: BoundingBox[][];
  classes: string[];
  hyperparameters: TrainingHyperparameters;
  gridSize?: number;
  hooks: TrainingControlHooks;
}): Promise<{
  status: 'completed' | 'cancelled';
  epochMetrics: EpochMetricPoint[];
  bestEpoch: number;
  bestValMetric: number;
  diagnostics: TrainingDiagnostics;
}> {
  const {
    model,
    xTrain,
    yTrainTargets,
    trainGroundTruth,
    xVal,
    yValTargets,
    valGroundTruth,
    classes,
    hyperparameters,
    gridSize = DETECTION_GRID_SIZE,
    hooks,
  } = params;

  if (model.trainableWeights.length === 0) {
    throw new Error('Detector model has zero trainable parameters.');
  }

  const optimizer = createOptimizer(hyperparameters.optimizer, hyperparameters.learningRate);
  const trainableVars = model.trainableWeights.map((w) => w.read() as tf.Variable);

  // Step-0 Gradient Diagnostic Check
  const probeCount = Math.min(2, xTrain.shape[0]);
  const probeCheck = tf.tidy(() => {
    const xb = xTrain.slice([0, 0, 0, 0], [probeCount, -1, -1, -1]) as tf.Tensor4D;
    const yb = yTrainTargets.slice([0, 0, 0, 0], [probeCount, -1, -1, -1]) as tf.Tensor4D;
    const { value, grads } = tf.variableGrads(() => {
      const pred = model.apply(xb, { training: true }) as tf.Tensor4D;
      return computeYoloBatchLoss(pred, yb, classes.length);
    }, trainableVars);
    let gradNorm = 0;
    for (const g of Object.values(grads)) {
      gradNorm += Number(tf.sum(tf.abs(g)).dataSync()[0] ?? 0);
    }
    return {
      lossValue: Number(value.dataSync()[0] ?? Number.NaN),
      gradL1Norm: gradNorm,
    };
  });

  if (!Number.isFinite(probeCheck.lossValue)) {
    throw new Error('Diagnostic failure: Detector forward pass produced NaN/Infinity loss.');
  }
  if (!(probeCheck.gradL1Norm > 0)) {
    throw new Error('Diagnostic failure: Detector backpropagation produced zero gradients.');
  }
  hooks.onLog(
    `[Diagnostic] Detector params: ${model.countParams().toLocaleString()} · Initial loss: ${probeCheck.lossValue.toFixed(4)} · Grad L1: ${probeCheck.gradL1Norm.toFixed(4)}`
  );

  const nTrain = xTrain.shape[0];
  const batchSize = Math.min(hyperparameters.batchSize, nTrain);
  const epochMetrics: EpochMetricPoint[] = [];
  let bestEpoch = 0;
  let bestValMetric = -1;
  let bestValLoss = Number.POSITIVE_INFINITY;
  let staleEpochs = 0;
  let bestWeights: tf.Tensor[] | null = null;
  let epoch1ParamDelta = 0;
  let allLossesFinite = true;

  for (let epoch = 1; epoch <= hyperparameters.epochs; epoch++) {
    const gate = await waitWhilePaused(hooks);
    if (gate === 'cancel') {
      bestWeights?.forEach((w) => w.dispose());
      return {
        status: 'cancelled',
        epochMetrics,
        bestEpoch: Math.max(1, bestEpoch),
        bestValMetric: Math.max(0, bestValMetric),
        diagnostics: {
          trainableParamCount: model.countParams(),
          initialGradientNorm: Number(probeCheck.gradL1Norm.toFixed(6)),
          epoch1ParamDelta: Number(epoch1ParamDelta.toFixed(6)),
          hasNonZeroGradients: probeCheck.gradL1Norm > 0,
          allLossesFinite,
          parametersUpdated: epoch1ParamDelta > 0,
        },
      };
    }

    const beforeSnapshot = epoch === 1 ? captureWeightSnapshot(model) : null;
    const t0 = performance.now();
    const indices = Array.from({ length: nTrain }, (_, idx) => idx);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    let epochLossSum = 0;
    let batchSteps = 0;

    for (let start = 0; start < nTrain; start += batchSize) {
      const innerGate = await waitWhilePaused(hooks);
      if (innerGate === 'cancel') {
        bestWeights?.forEach((w) => w.dispose());
        return {
          status: 'cancelled',
          epochMetrics,
          bestEpoch: Math.max(1, bestEpoch),
          bestValMetric: Math.max(0, bestValMetric),
          diagnostics: {
            trainableParamCount: model.countParams(),
            initialGradientNorm: Number(probeCheck.gradL1Norm.toFixed(6)),
            epoch1ParamDelta: Number(epoch1ParamDelta.toFixed(6)),
            hasNonZeroGradients: probeCheck.gradL1Norm > 0,
            allLossesFinite,
            parametersUpdated: epoch1ParamDelta > 0,
          },
        };
      }

      const sliceIdx = indices.slice(start, start + batchSize);
      const lossVal = tf.tidy(() => {
        const idxTensor = tf.tensor1d(sliceIdx, 'int32');
        const xb = tf.gather(xTrain, idxTensor) as tf.Tensor4D;
        const yb = tf.gather(yTrainTargets, idxTensor) as tf.Tensor4D;

        const { value, grads } = tf.variableGrads(() => {
          const pred = model.apply(xb, { training: true }) as tf.Tensor4D;
          return computeYoloBatchLoss(pred, yb, classes.length);
        }, trainableVars);

        optimizer.applyGradients(
          Object.entries(grads).map(([name, tensor]) => ({ name, tensor }))
        );
        return value.dataSync()[0];
      });

      if (!Number.isFinite(lossVal)) {
        allLossesFinite = false;
        bestWeights?.forEach((w) => w.dispose());
        throw new Error(`Detector training diverged at epoch ${epoch}: non-finite batch loss (${lossVal}).`);
      }

      epochLossSum += lossVal;
      batchSteps += 1;
      await tf.nextFrame();
    }

    if (beforeSnapshot) {
      epoch1ParamDelta = measureWeightL1Delta(beforeSnapshot, model);
      if (!(epoch1ParamDelta > 0)) {
        throw new Error('Diagnostic failure: Detector weights did not change after Epoch 1 optimizer step.');
      }
      hooks.onLog(`[Diagnostic] Epoch 1 weight update ΔW L1 = ${epoch1ParamDelta.toFixed(4)}`);
    }

    const avgTrainLoss = epochLossSum / Math.max(1, batchSteps);
    const perCellStride = gridSize * gridSize * (5 + classes.length);

    let trainF1 = 0;
    if (trainGroundTruth && trainGroundTruth.length === nTrain) {
      const trainEvalData = tf.tidy(() => {
        const predTrain = model.predict(xTrain) as tf.Tensor4D;
        return new Float32Array(predTrain.dataSync() as Float32Array);
      });
      const trainPredBoxes: DetectedBox[][] = [];
      for (let i = 0; i < nTrain; i++) {
        const slice = trainEvalData.subarray(i * perCellStride, (i + 1) * perCellStride);
        trainPredBoxes.push(
          decodeGridDetections(
            slice,
            classes,
            gridSize,
            hyperparameters.confidenceThreshold,
            hyperparameters.iouThreshold
          )
        );
      }
      trainF1 = computeDetectionMetrics(
        trainGroundTruth,
        trainPredBoxes,
        classes,
        hyperparameters.iouThreshold
      ).f1Score;
    }

    const valEval = tf.tidy(() => {
      const predVal = model.predict(xVal) as tf.Tensor4D;
      const valLoss = computeYoloBatchLoss(predVal, yValTargets, classes.length).dataSync()[0];
      const predData = predVal.dataSync() as Float32Array;
      return { valLoss, predData: new Float32Array(predData) };
    });

    if (!Number.isFinite(valEval.valLoss)) {
      allLossesFinite = false;
      bestWeights?.forEach((w) => w.dispose());
      throw new Error(`Detector validation produced non-finite loss at epoch ${epoch}.`);
    }

    const valPredBoxes: DetectedBox[][] = [];
    for (let i = 0; i < xVal.shape[0]; i++) {
      const slice = valEval.predData.subarray(i * perCellStride, (i + 1) * perCellStride);
      valPredBoxes.push(
        decodeGridDetections(
          slice,
          classes,
          gridSize,
          hyperparameters.confidenceThreshold,
          hyperparameters.iouThreshold
        )
      );
    }

    const detStats = computeDetectionMetrics(
      valGroundTruth,
      valPredBoxes,
      classes,
      hyperparameters.iouThreshold
    );

    const durationMs = Math.max(1, Math.round(performance.now() - t0));
    const point: EpochMetricPoint = {
      epoch,
      trainLoss: Number(avgTrainLoss.toFixed(5)),
      valLoss: Number(valEval.valLoss.toFixed(5)),
      trainMetric: Number((trainGroundTruth ? trainF1 : detStats.f1Score).toFixed(4)),
      valMetric: Number(detStats.mAP50.toFixed(4)),
      durationMs,
    };
    epochMetrics.push(point);

    const improved =
      detStats.mAP50 > bestValMetric ||
      (detStats.mAP50 === bestValMetric && valEval.valLoss < bestValLoss);
    if (improved) {
      bestValMetric = detStats.mAP50;
      bestValLoss = valEval.valLoss;
      bestEpoch = epoch;
      staleEpochs = 0;
      bestWeights?.forEach((w) => w.dispose());
      bestWeights = model.getWeights().map((w) => w.clone());
      if (hyperparameters.saveCheckpoints && hooks.onSaveCheckpoint) {
        await hooks.onSaveCheckpoint(model, epoch);
      }
    } else {
      staleEpochs += 1;
    }

    hooks.onLog(
      `Epoch ${epoch}/${hyperparameters.epochs} — loss: ${point.trainLoss.toFixed(4)} · val_loss: ${point.valLoss.toFixed(4)} · mAP@50: ${(
        detStats.mAP50 * 100
      ).toFixed(1)}% · meanIoU: ${(detStats.meanIoU * 100).toFixed(1)}% (${durationMs}ms)`
    );
    await hooks.onEpoch(point, bestEpoch, Math.max(0, bestValMetric));

    if (
      hyperparameters.earlyStoppingPatience > 0 &&
      staleEpochs >= hyperparameters.earlyStoppingPatience &&
      epoch >= 8
    ) {
      hooks.onLog(`Early stopping triggered at epoch ${epoch} (best epoch ${bestEpoch}).`);
      break;
    }
  }

  if (bestWeights) {
    model.setWeights(bestWeights);
    bestWeights.forEach((w) => w.dispose());
  }

  return {
    status: 'completed',
    epochMetrics,
    bestEpoch: Math.max(1, bestEpoch),
    bestValMetric: Math.max(0, bestValMetric),
    diagnostics: {
      trainableParamCount: model.countParams(),
      initialGradientNorm: Number(probeCheck.gradL1Norm.toFixed(6)),
      epoch1ParamDelta: Number(epoch1ParamDelta.toFixed(6)),
      hasNonZeroGradients: probeCheck.gradL1Norm > 0,
      allLossesFinite,
      parametersUpdated: epoch1ParamDelta > 0,
    },
  };
}

/**
 * Overfitting Sanity Test on a small tensor subset (zero augmentation).
 * Verifies genuine forward pass, non-zero gradients, parameter updates, and loss drop.
 */
export async function runOverfittingSanityTest(params: {
  taskType: V1TaskType;
  architecture: string;
  classes: string[];
  xSubset: tf.Tensor4D;
  ySubsetOneHot?: tf.Tensor2D;
  ySubsetIndices?: number[];
  boxesSubset?: BoundingBox[][];
  inputSize: number;
  steps?: number;
  learningRate?: number;
}): Promise<SanityTestResult> {
  await tf.ready();
  const details: string[] = [];
  const sampleCount = params.xSubset.shape[0];
  const steps = Math.max(10, params.steps ?? 25);

  if (sampleCount < 2) {
    throw new Error('Sanity test requires at least 2 samples.');
  }

  if (params.taskType === 'image_classification') {
    if (!params.ySubsetOneHot || !params.ySubsetIndices) {
      throw new Error('Classification sanity test requires ySubsetOneHot and ySubsetIndices.');
    }
    const model = buildClassificationModel(
      params.architecture,
      params.inputSize,
      params.classes.length
    );
    const optimizer = tf.train.adam(params.learningRate ?? 0.002);
    model.compile({
      optimizer,
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });

    const beforeWeights = captureWeightSnapshot(model);
    const initProbe = computeClassifierGradNorm(model, params.xSubset, params.ySubsetOneHot);

    try {
      const history = await model.fit(params.xSubset, params.ySubsetOneHot, {
        epochs: steps,
        batchSize: sampleCount,
        shuffle: false,
        verbose: 0,
      });

      const losses = (history.history.loss || []).map((v) => Number(v));
      const initialLoss = Number.isFinite(initProbe.lossValue)
        ? initProbe.lossValue
        : losses[0] ?? 0;
      const finalLoss = losses[losses.length - 1] ?? initialLoss;
      const paramDelta = measureWeightL1Delta(beforeWeights, model);

      const preds = tf.tidy(() => {
        const out = model.predict(params.xSubset) as tf.Tensor2D;
        return Array.from(out.argMax(1).dataSync());
      });
      const stats = computeClassificationMetrics(params.ySubsetIndices, preds, params.classes);
      const lossReductionPct =
        initialLoss > 0 ? ((initialLoss - finalLoss) / initialLoss) * 100 : 0;

      const passed =
        Number.isFinite(initialLoss) &&
        Number.isFinite(finalLoss) &&
        initProbe.gradL1Norm > 0 &&
        paramDelta > 0 &&
        finalLoss < initialLoss &&
        stats.accuracy >= 0.75;

      details.push(`Initial loss: ${initialLoss.toFixed(4)} -> Final loss: ${finalLoss.toFixed(4)} (-${lossReductionPct.toFixed(1)}%)`);
      details.push(`Gradient L1 norm: ${initProbe.gradL1Norm.toFixed(4)} · Weight ΔW L1: ${paramDelta.toFixed(4)}`);
      details.push(`Overfit subset accuracy: ${(stats.accuracy * 100).toFixed(1)}% (Error rate: ${(stats.errorRate * 100).toFixed(1)}%)`);

      return {
        passed,
        taskType: params.taskType,
        architecture: params.architecture,
        sampleCount,
        stepsExecuted: steps,
        initialLoss: Number(initialLoss.toFixed(5)),
        finalLoss: Number(finalLoss.toFixed(5)),
        lossReductionPct: Number(lossReductionPct.toFixed(1)),
        paramDelta: Number(paramDelta.toFixed(5)),
        hasNonZeroGradients: initProbe.gradL1Norm > 0,
        subsetAccuracy: stats.accuracy,
        details,
      };
    } finally {
      model.dispose();
    }
  }

  // Object detection sanity test
  if (!params.boxesSubset) {
    throw new Error('Detection sanity test requires boxesSubset.');
  }
  const model = buildGridYoloModel(params.inputSize, params.classes.length, DETECTION_GRID_SIZE);
  const optimizer = tf.train.adam(params.learningRate ?? 0.003);
  const trainableVars = model.trainableWeights.map((w) => w.read() as tf.Variable);
  const yTargets = encodeGridTargets(params.boxesSubset, params.classes, DETECTION_GRID_SIZE);

  try {
    const beforeWeights = captureWeightSnapshot(model);
    let initialLoss = 0;
    let finalLoss = 0;
    let gradNorm = 0;

    for (let step = 0; step < steps; step++) {
      const stepRes = tf.tidy(() => {
        const { value, grads } = tf.variableGrads(() => {
          const pred = model.apply(params.xSubset, { training: true }) as tf.Tensor4D;
          return computeYoloBatchLoss(pred, yTargets, params.classes.length);
        }, trainableVars);
        let gSum = 0;
        if (step === 0) {
          for (const g of Object.values(grads)) {
            gSum += Number(tf.sum(tf.abs(g)).dataSync()[0] ?? 0);
          }
        }
        optimizer.applyGradients(
          Object.entries(grads).map(([name, tensor]) => ({ name, tensor }))
        );
        return { loss: Number(value.dataSync()[0]), gSum };
      });
      if (step === 0) {
        initialLoss = stepRes.loss;
        gradNorm = stepRes.gSum;
      }
      finalLoss = stepRes.loss;
    }

    const paramDelta = measureWeightL1Delta(beforeWeights, model);
    const predData = tf.tidy(() => {
      const out = model.predict(params.xSubset) as tf.Tensor4D;
      return new Float32Array(out.dataSync() as Float32Array);
    });
    const stride = DETECTION_GRID_SIZE * DETECTION_GRID_SIZE * (5 + params.classes.length);
    const predBoxes: DetectedBox[][] = [];
    for (let i = 0; i < sampleCount; i++) {
      predBoxes.push(
        decodeGridDetections(
          predData.subarray(i * stride, (i + 1) * stride),
          params.classes,
          DETECTION_GRID_SIZE,
          0.25,
          0.5
        )
      );
    }
    const detStats = computeDetectionMetrics(params.boxesSubset, predBoxes, params.classes, 0.5);
    const lossReductionPct = initialLoss > 0 ? ((initialLoss - finalLoss) / initialLoss) * 100 : 0;
    const passed =
      Number.isFinite(initialLoss) &&
      Number.isFinite(finalLoss) &&
      gradNorm > 0 &&
      paramDelta > 0 &&
      finalLoss < initialLoss * 0.85;

    details.push(`Initial loss: ${initialLoss.toFixed(4)} -> Final loss: ${finalLoss.toFixed(4)} (-${lossReductionPct.toFixed(1)}%)`);
    details.push(`Gradient L1 norm: ${gradNorm.toFixed(4)} · Weight ΔW L1: ${paramDelta.toFixed(4)}`);
    details.push(`Subset mAP@50: ${(detStats.mAP50 * 100).toFixed(1)}% · Mean IoU: ${(detStats.meanIoU * 100).toFixed(1)}%`);

    return {
      passed,
      taskType: params.taskType,
      architecture: params.architecture,
      sampleCount,
      stepsExecuted: steps,
      initialLoss: Number(initialLoss.toFixed(5)),
      finalLoss: Number(finalLoss.toFixed(5)),
      lossReductionPct: Number(lossReductionPct.toFixed(1)),
      paramDelta: Number(paramDelta.toFixed(5)),
      hasNonZeroGradients: gradNorm > 0,
      subsetAccuracy: detStats.mAP50,
      details,
    };
  } finally {
    yTargets.dispose();
    model.dispose();
  }
}

export async function runDatasetOverfittingSanityTest(params: {
  taskType: V1TaskType;
  architecture: string;
  dataset: Dataset;
  items: DatasetItem[];
  inputSize: number;
}): Promise<SanityTestResult> {
  const { dataset, items, taskType, architecture, inputSize } = params;
  const classes = dataset.classes;
  if (classes.length === 0) {
    throw new Error('Dataset has no defined classes.');
  }

  const annotated = items.filter((it) =>
    taskType === 'image_classification'
      ? Boolean(it.classificationLabel && classes.includes(it.classificationLabel))
      : Array.isArray(it.annotations) && it.annotations.length > 0
  );

  // Pick up to 6 samples spanning multiple classes if available
  const picked: DatasetItem[] = [];
  if (taskType === 'image_classification') {
    for (const cls of classes) {
      const matches = annotated.filter((it) => it.classificationLabel === cls).slice(0, 2);
      picked.push(...matches);
      if (picked.length >= 6) break;
    }
  }
  for (const it of annotated) {
    if (picked.length >= 6) break;
    if (!picked.some((p) => p.id === it.id)) picked.push(it);
  }

  if (picked.length < 2) {
    throw new Error('Need at least 2 annotated samples with local images for overfitting sanity check.');
  }

  const tensors: tf.Tensor3D[] = [];
  const validPicked: DatasetItem[] = [];
  for (const item of picked) {
    const blob = await getMediaBlob(item.id);
    if (!blob) continue;
    tensors.push(await blobToNormalizedTensor(blob, inputSize, null));
    validPicked.push(item);
  }

  if (validPicked.length < 2) {
    tensors.forEach((t) => t.dispose());
    throw new Error('Local image blobs for selected sanity samples are missing from IndexedDB.');
  }

  const xSubset = tf.stack(tensors) as tf.Tensor4D;
  tensors.forEach((t) => t.dispose());

  try {
    if (taskType === 'image_classification') {
      const indices = validPicked.map((it) => classes.indexOf(it.classificationLabel));
      const yOH = tf.oneHot(tf.tensor1d(indices, 'int32'), classes.length) as tf.Tensor2D;
      try {
        return await runOverfittingSanityTest({
          taskType,
          architecture,
          classes,
          xSubset,
          ySubsetOneHot: yOH,
          ySubsetIndices: indices,
          inputSize,
          steps: 25,
        });
      } finally {
        yOH.dispose();
      }
    }

    return await runOverfittingSanityTest({
      taskType,
      architecture,
      classes,
      xSubset,
      boxesSubset: validPicked.map((it) => it.annotations),
      inputSize,
      steps: 28,
    });
  } finally {
    xSubset.dispose();
  }
}

async function blobToNormalizedTensor(
  blob: Blob,
  inputSize: number,
  augmentConfig?: Dataset['augmentationConfig'] | null
): Promise<tf.Tensor3D> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode dataset image blob'));
      el.src = url;
    });

    const canvas = document.createElement('canvas');
    // Unified letterbox preprocessing for Train, Val, Test, and Inference
    renderPreprocessedCanvas(canvas, img, inputSize, augmentConfig ?? null, {
      stochastic: Boolean(augmentConfig),
    });

    return tf.tidy(() => {
      const raw = tf.browser.fromPixels(canvas);
      return tf.div(tf.cast(raw, 'float32'), 255) as tf.Tensor3D;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface BrowserTrainingResult {
  status: 'completed' | 'cancelled';
  epochMetrics: EpochMetricPoint[];
  bestEpoch: number;
  bestValMetric: number;
  evaluatedSplit: 'test' | 'val';
  parameterCount: number;
  weightSizeBytes: number;
  inferenceLatencyMs: number;
  accuracy: number;
  errorRate: number;
  precision: number;
  recall: number;
  f1Score: number;
  mAP50: number;
  mAP50_95: number;
  meanIoU: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
  hardwareSummary: string;
  diagnostics?: TrainingDiagnostics;
}

export async function runBrowserTrainingPipeline(params: {
  runId: string;
  modelId: string;
  projectId: string;
  taskType: V1TaskType;
  architecture: string;
  dataset: Dataset;
  items: DatasetItem[];
  hyperparameters: TrainingHyperparameters;
  hooks: TrainingControlHooks;
}): Promise<BrowserTrainingResult> {
  await tf.ready();
  const backend = tf.getBackend() || 'cpu';
  const hardwareSummary = `Browser TensorFlow.js (${backend.toUpperCase()})`;
  params.hooks.onLog(`TensorFlow.js ready on backend: ${backend.toUpperCase()}`);

  const classes = params.dataset.classes;
  if (classes.length === 0) {
    throw new Error('Dataset has no defined classes.');
  }

  const availableBlobIds = await listStoredDatasetBlobIds(params.dataset.id);
  const validation = validateDatasetForTraining({
    dataset: params.dataset,
    items: params.items,
    taskType: params.taskType,
    availableBlobIds,
  });

  for (const warn of validation.warnings) {
    params.hooks.onLog(`[Dataset Warning] ${warn}`);
  }
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '));
  }

  const isAnnotated = (item: DatasetItem) =>
    availableBlobIds.has(item.id) &&
    (params.taskType === 'image_classification'
      ? item.classificationLabel.trim().length > 0 && classes.includes(item.classificationLabel)
      : item.annotations.some((b) => classes.includes(b.className)));

  const trainItems = params.items.filter((it) => it.split === 'train' && isAnnotated(it));
  const valItemsRaw = params.items.filter((it) => it.split === 'val' && isAnnotated(it));
  const testItemsRaw = params.items.filter((it) => it.split === 'test' && isAnnotated(it));

  if (trainItems.length < 2) {
    throw new Error('At least 2 annotated images with local blobs in Train split are required.');
  }

  const valItems =
    valItemsRaw.length > 0
      ? valItemsRaw
      : trainItems.slice(0, Math.max(1, Math.floor(trainItems.length / 3)));
  const evaluatedSplit: 'test' | 'val' = testItemsRaw.length > 0 ? 'test' : 'val';
  const testItems = testItemsRaw.length > 0 ? testItemsRaw : valItems;

  params.hooks.onLog(
    `Loaded splits — Train: ${trainItems.length} (letterboxed + aug), Val: ${valItems.length} (clean letterbox), Test: ${testItems.length} (clean letterbox)`
  );

  const loadSplitTensors = async (splitItems: DatasetItem[], applyTrainAug: boolean) => {
    const tensors: tf.Tensor3D[] = [];
    const validItems: DatasetItem[] = [];
    const missingItems: string[] = [];

    for (const item of splitItems) {
      const blob = await getMediaBlob(item.id);
      if (!blob) {
        missingItems.push(item.filename);
        continue;
      }
      const augForTask =
        applyTrainAug
          ? params.taskType === 'object_detection'
            ? {
                ...params.dataset.augmentationConfig,
                rotateDeg: 0,
                flipHorizontal: false,
                flipVertical: false,
              }
            : params.dataset.augmentationConfig
          : null;
      const tensor = await blobToNormalizedTensor(
        blob,
        params.hyperparameters.inputSize,
        augForTask
      );
      tensors.push(tensor);
      validItems.push(item);
    }

    if (missingItems.length > 0) {
      params.hooks.onLog(
        `[Dataset Warning] ${missingItems.length} image blob(s) could not be read: ${missingItems.slice(0, 5).join(', ')}`
      );
    }
    if (tensors.length === 0) {
      throw new Error('No readable image blobs found in IndexedDB for this dataset split.');
    }
    const stacked = tf.stack(tensors) as tf.Tensor4D;
    tensors.forEach((t) => t.dispose());
    return { stacked, validItems };
  };

  const trainLoaded = await loadSplitTensors(trainItems, true);
  const valLoaded = await loadSplitTensors(valItems, false);
  const testLoaded = await loadSplitTensors(testItems, false);

  let model: tf.LayersModel | null = null;

  try {
    if (params.taskType === 'image_classification') {
      model = buildClassificationModel(
        params.architecture,
        params.hyperparameters.inputSize,
        classes.length
      );

      const yTrainIdx = trainLoaded.validItems.map((it) => classes.indexOf(it.classificationLabel));
      const yValIdx = valLoaded.validItems.map((it) => classes.indexOf(it.classificationLabel));
      const yTestIdx = testLoaded.validItems.map((it) => classes.indexOf(it.classificationLabel));

      if (yTrainIdx.some((i) => i < 0) || yValIdx.some((i) => i < 0) || yTestIdx.some((i) => i < 0)) {
        throw new Error('Class-index mapping mismatch: unknown label encountered outside dataset.classes.');
      }

      const yTrainOH = tf.oneHot(tf.tensor1d(yTrainIdx, 'int32'), classes.length) as tf.Tensor2D;
      const yValOH = tf.oneHot(tf.tensor1d(yValIdx, 'int32'), classes.length) as tf.Tensor2D;

      try {
        const trainResult = await trainClassifierCore({
          model,
          xTrain: trainLoaded.stacked,
          yTrainOneHot: yTrainOH,
          xVal: valLoaded.stacked,
          yValOneHot: yValOH,
          yValIndices: yValIdx,
          classes,
          hyperparameters: params.hyperparameters,
          hooks: {
            ...params.hooks,
            onSaveCheckpoint: async (m, ep) => {
              await saveTfModelToIndexedDb({
                key: `ckpt_${params.runId}`,
                projectId: params.projectId,
                runId: params.runId,
                classes,
                inputSize: params.hyperparameters.inputSize,
                taskType: params.taskType,
                architecture: params.architecture,
                model: m,
              });
              params.hooks.onLog(`Checkpoint saved at epoch ${ep}.`);
            },
          },
        });

        if (trainResult.status === 'cancelled') {
          return {
            status: 'cancelled',
            epochMetrics: trainResult.epochMetrics,
            bestEpoch: trainResult.bestEpoch,
            bestValMetric: trainResult.bestValMetric,
            evaluatedSplit,
            parameterCount: model.countParams(),
            weightSizeBytes: 0,
            inferenceLatencyMs: 0,
            accuracy: 0,
            errorRate: 1,
            precision: 0,
            recall: 0,
            f1Score: 0,
            mAP50: 0,
            mAP50_95: 0,
            meanIoU: 0,
            confusionLabels: [],
            confusionFlat: [],
            perClassMetrics: [],
            hardwareSummary,
            diagnostics: trainResult.diagnostics,
          };
        }

        const tInf0 = performance.now();
        const testPredIdx = tf.tidy(() => {
          const probs = model!.predict(testLoaded.stacked) as tf.Tensor2D;
          return Array.from(probs.argMax(1).dataSync());
        });
        const inferenceLatencyMs = Number(
          ((performance.now() - tInf0) / Math.max(1, testLoaded.validItems.length)).toFixed(2)
        );
        const evalMetrics = computeClassificationMetrics(yTestIdx, testPredIdx, classes);
        const saved = await saveTfModelToIndexedDb({
          key: params.modelId,
          projectId: params.projectId,
          runId: params.runId,
          classes,
          inputSize: params.hyperparameters.inputSize,
          taskType: params.taskType,
          architecture: params.architecture,
          model,
        });

        return {
          status: 'completed',
          epochMetrics: trainResult.epochMetrics,
          bestEpoch: trainResult.bestEpoch,
          bestValMetric: trainResult.bestValMetric,
          evaluatedSplit,
          parameterCount: model.countParams(),
          weightSizeBytes: saved.sizeBytes,
          inferenceLatencyMs,
          accuracy: evalMetrics.accuracy,
          errorRate: evalMetrics.errorRate,
          precision: evalMetrics.precision,
          recall: evalMetrics.recall,
          f1Score: evalMetrics.f1Score,
          mAP50: 0,
          mAP50_95: 0,
          meanIoU: 0,
          confusionLabels: evalMetrics.confusionLabels,
          confusionFlat: evalMetrics.confusionFlat,
          perClassMetrics: evalMetrics.perClassMetrics,
          hardwareSummary,
          diagnostics: trainResult.diagnostics,
        };
      } finally {
        yTrainOH.dispose();
        yValOH.dispose();
      }
    } else {
      model = buildGridYoloModel(params.hyperparameters.inputSize, classes.length, DETECTION_GRID_SIZE);
      const yTrainTargets = encodeGridTargets(
        trainLoaded.validItems.map((it) => it.annotations),
        classes,
        DETECTION_GRID_SIZE
      );
      const yValTargets = encodeGridTargets(
        valLoaded.validItems.map((it) => it.annotations),
        classes,
        DETECTION_GRID_SIZE
      );

      try {
        const trainResult = await trainDetectorCore({
          model,
          xTrain: trainLoaded.stacked,
          yTrainTargets,
          trainGroundTruth: trainLoaded.validItems.map((it) => it.annotations),
          xVal: valLoaded.stacked,
          yValTargets,
          valGroundTruth: valLoaded.validItems.map((it) => it.annotations),
          classes,
          hyperparameters: params.hyperparameters,
          gridSize: DETECTION_GRID_SIZE,
          hooks: {
            ...params.hooks,
            onSaveCheckpoint: async (m, ep) => {
              await saveTfModelToIndexedDb({
                key: `ckpt_${params.runId}`,
                projectId: params.projectId,
                runId: params.runId,
                classes,
                inputSize: params.hyperparameters.inputSize,
                taskType: params.taskType,
                architecture: params.architecture,
                model: m,
              });
              params.hooks.onLog(`Detection checkpoint saved at epoch ${ep}.`);
            },
          },
        });

        if (trainResult.status === 'cancelled') {
          return {
            status: 'cancelled',
            epochMetrics: trainResult.epochMetrics,
            bestEpoch: trainResult.bestEpoch,
            bestValMetric: trainResult.bestValMetric,
            evaluatedSplit,
            parameterCount: model.countParams(),
            weightSizeBytes: 0,
            inferenceLatencyMs: 0,
            accuracy: 0,
            errorRate: 1,
            precision: 0,
            recall: 0,
            f1Score: 0,
            mAP50: 0,
            mAP50_95: 0,
            meanIoU: 0,
            confusionLabels: [],
            confusionFlat: [],
            perClassMetrics: [],
            hardwareSummary,
            diagnostics: trainResult.diagnostics,
          };
        }

        const tInf0 = performance.now();
        const testPredData = tf.tidy(() => {
          const pred = model!.predict(testLoaded.stacked) as tf.Tensor4D;
          return new Float32Array(pred.dataSync() as Float32Array);
        });
        const inferenceLatencyMs = Number(
          ((performance.now() - tInf0) / Math.max(1, testLoaded.validItems.length)).toFixed(2)
        );

        const perImageStride = DETECTION_GRID_SIZE * DETECTION_GRID_SIZE * (5 + classes.length);
        const testPredBoxes: DetectedBox[][] = [];
        for (let i = 0; i < testLoaded.validItems.length; i++) {
          const slice = testPredData.subarray(i * perImageStride, (i + 1) * perImageStride);
          testPredBoxes.push(
            decodeGridDetections(
              slice,
              classes,
              DETECTION_GRID_SIZE,
              params.hyperparameters.confidenceThreshold,
              params.hyperparameters.iouThreshold
            )
          );
        }

        const detMetrics = computeDetectionMetrics(
          testLoaded.validItems.map((it) => it.annotations),
          testPredBoxes,
          classes,
          params.hyperparameters.iouThreshold
        );

        const saved = await saveTfModelToIndexedDb({
          key: params.modelId,
          projectId: params.projectId,
          runId: params.runId,
          classes,
          inputSize: params.hyperparameters.inputSize,
          taskType: params.taskType,
          architecture: params.architecture,
          model,
        });

        return {
          status: 'completed',
          epochMetrics: trainResult.epochMetrics,
          bestEpoch: trainResult.bestEpoch,
          bestValMetric: trainResult.bestValMetric,
          evaluatedSplit,
          parameterCount: model.countParams(),
          weightSizeBytes: saved.sizeBytes,
          inferenceLatencyMs,
          accuracy: detMetrics.mAP50,
          errorRate: Number(Math.max(0, 1 - detMetrics.mAP50).toFixed(4)),
          precision: detMetrics.precision,
          recall: detMetrics.recall,
          f1Score: detMetrics.f1Score,
          mAP50: detMetrics.mAP50,
          mAP50_95: detMetrics.mAP50_95,
          meanIoU: detMetrics.meanIoU,
          confusionLabels: detMetrics.confusionLabels,
          confusionFlat: detMetrics.confusionFlat,
          perClassMetrics: detMetrics.perClassMetrics,
          hardwareSummary,
          diagnostics: trainResult.diagnostics,
        };
      } finally {
        yTrainTargets.dispose();
        yValTargets.dispose();
      }
    }
  } finally {
    trainLoaded.stacked.dispose();
    valLoaded.stacked.dispose();
    testLoaded.stacked.dispose();
    model?.dispose();
  }
}

export async function predictImageWithLocalModel(params: {
  model: tf.LayersModel;
  taskType: V1TaskType;
  classes: string[];
  inputSize: number;
  imageBlob: Blob;
  confidenceThreshold: number;
  iouThreshold: number;
}): Promise<InferencePrediction> {
  const tensor3d = await blobToNormalizedTensor(params.imageBlob, params.inputSize, null);
  const t0 = performance.now();
  try {
    if (params.taskType === 'image_classification') {
      const probs = tf.tidy(() => {
        const batch = tensor3d.expandDims(0) as tf.Tensor4D;
        const out = params.model.predict(batch) as tf.Tensor2D;
        return Array.from(out.dataSync());
      });
      const latencyMs = Number((performance.now() - t0).toFixed(2));
      const classifications = params.classes
        .map((className, idx) => ({
          className,
          confidence: Number((probs[idx] ?? 0).toFixed(4)),
        }))
        .sort((a, b) => b.confidence - a.confidence);
      return {
        taskType: 'image_classification',
        latencyMs,
        classifications,
        detections: [],
      };
    }

    const rawGrid = tf.tidy(() => {
      const batch = tensor3d.expandDims(0) as tf.Tensor4D;
      const out = params.model.predict(batch) as tf.Tensor4D;
      return new Float32Array(out.dataSync() as Float32Array);
    });
    const latencyMs = Number((performance.now() - t0).toFixed(2));
    const detections = decodeGridDetections(
      rawGrid,
      params.classes,
      DETECTION_GRID_SIZE,
      params.confidenceThreshold,
      params.iouThreshold
    ).map((d) => ({
      className: d.className,
      confidence: d.confidence,
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
    }));

    return {
      taskType: 'object_detection',
      latencyMs,
      classifications: [],
      detections,
    };
  } finally {
    tensor3d.dispose();
  }
}

export function computeLatencyPercentiles(latenciesMs: number[]): {
  avgLatencyMs: number;
  p95LatencyMs: number;
} {
  if (latenciesMs.length === 0) {
    return { avgLatencyMs: 0, p95LatencyMs: 0 };
  }
  const sum = latenciesMs.reduce((acc, v) => acc + v, 0);
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const p95Idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return {
    avgLatencyMs: Number((sum / latenciesMs.length).toFixed(2)),
    p95LatencyMs: Number(sorted[p95Idx].toFixed(2)),
  };
}

export async function evaluateLocalModelOnItems(params: {
  model: tf.LayersModel;
  modelId: string;
  taskType: V1TaskType;
  classes: string[];
  inputSize: number;
  items: DatasetItem[];
  split: EvaluationSplitTarget;
  confidenceThreshold: number;
  iouThreshold: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<BatchEvaluationResult> {
  const candidates = params.items.filter((it) => {
    const splitMatch = params.split === 'all' || it.split === params.split;
    if (!splitMatch) return false;
    if (params.taskType === 'image_classification') {
      return Boolean(it.classificationLabel && params.classes.includes(it.classificationLabel));
    }
    return Array.isArray(it.annotations) && it.annotations.length > 0;
  });

  if (candidates.length === 0) {
    throw new Error('No annotated images found in the selected dataset split for this model.');
  }

  const samples: BatchEvalSampleResult[] = [];
  const latencies: number[] = [];
  let skippedMissingBlobCount = 0;

  const yTrueIdx: number[] = [];
  const yPredIdx: number[] = [];
  const gtBoxesList: BoundingBox[][] = [];
  const predBoxesList: DetectedBox[][] = [];

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    const blob = await getMediaBlob(item.id);
    if (!blob) {
      skippedMissingBlobCount += 1;
      params.onProgress?.(i + 1, candidates.length);
      continue;
    }

    const pred = await predictImageWithLocalModel({
      model: params.model,
      taskType: params.taskType,
      classes: params.classes,
      inputSize: params.inputSize,
      imageBlob: blob,
      confidenceThreshold: params.confidenceThreshold,
      iouThreshold: params.iouThreshold,
    });

    latencies.push(pred.latencyMs);

    if (params.taskType === 'image_classification') {
      const top = pred.classifications[0] || { className: params.classes[0] || '', confidence: 0 };
      const trueIdx = params.classes.indexOf(item.classificationLabel);
      const predIdx = params.classes.indexOf(top.className);
      yTrueIdx.push(trueIdx >= 0 ? trueIdx : 0);
      yPredIdx.push(predIdx >= 0 ? predIdx : 0);

      samples.push({
        itemId: item.id,
        filename: item.filename,
        split: item.split,
        groundTruthLabel: item.classificationLabel,
        predictedLabel: top.className,
        confidence: top.confidence,
        correct: top.className === item.classificationLabel,
        latencyMs: pred.latencyMs,
        groundTruthBoxes: [],
        predictedBoxes: [],
      });
    } else {
      const decoded: DetectedBox[] = pred.detections.map((d) => ({
        ...d,
        classIndex: Math.max(0, params.classes.indexOf(d.className)),
      }));
      gtBoxesList.push(item.annotations);
      predBoxesList.push(decoded);

      const matchedGt = new Set<number>();
      let tpCount = 0;
      for (const pBox of decoded) {
        let bestG = -1;
        let bestIoU = 0;
        for (let g = 0; g < item.annotations.length; g++) {
          if (matchedGt.has(g)) continue;
          const iou = computeIoU(pBox, item.annotations[g]);
          if (iou >= params.iouThreshold && iou > bestIoU) {
            bestIoU = iou;
            bestG = g;
          }
        }
        if (bestG >= 0) {
          matchedGt.add(bestG);
          if (item.annotations[bestG].className === pBox.className) {
            tpCount += 1;
          }
        }
      }
      const exactMatch =
        tpCount === item.annotations.length && decoded.length === item.annotations.length;

      samples.push({
        itemId: item.id,
        filename: item.filename,
        split: item.split,
        groundTruthLabel: item.annotations.map((a) => a.className).join(', '),
        predictedLabel: decoded.map((d) => d.className).join(', '),
        confidence: decoded[0]?.confidence ?? 0,
        correct: exactMatch,
        latencyMs: pred.latencyMs,
        groundTruthBoxes: item.annotations,
        predictedBoxes: pred.detections,
      });
    }

    params.onProgress?.(i + 1, candidates.length);
  }

  if (samples.length === 0) {
    throw new Error('None of the selected images have local media blobs stored on this browser.');
  }

  const { avgLatencyMs, p95LatencyMs } = computeLatencyPercentiles(latencies);

  if (params.taskType === 'image_classification') {
    const clsMetrics = computeClassificationMetrics(yTrueIdx, yPredIdx, params.classes);
    return {
      modelId: params.modelId,
      split: params.split,
      sampleCount: samples.length,
      skippedMissingBlobCount,
      confidenceThreshold: params.confidenceThreshold,
      iouThreshold: params.iouThreshold,
      accuracy: clsMetrics.accuracy,
      errorRate: clsMetrics.errorRate,
      precision: clsMetrics.precision,
      recall: clsMetrics.recall,
      f1Score: clsMetrics.f1Score,
      mAP50: 0,
      mAP50_95: 0,
      meanIoU: 0,
      avgLatencyMs,
      p95LatencyMs,
      confusionLabels: clsMetrics.confusionLabels,
      confusionFlat: clsMetrics.confusionFlat,
      perClassMetrics: clsMetrics.perClassMetrics,
      samples,
    };
  }

  const detMetrics = computeDetectionMetrics(
    gtBoxesList,
    predBoxesList,
    params.classes,
    params.iouThreshold
  );
  return {
    modelId: params.modelId,
    split: params.split,
    sampleCount: samples.length,
    skippedMissingBlobCount,
    confidenceThreshold: params.confidenceThreshold,
    iouThreshold: params.iouThreshold,
    accuracy: detMetrics.mAP50,
    errorRate: Number(Math.max(0, 1 - detMetrics.mAP50).toFixed(4)),
    precision: detMetrics.precision,
    recall: detMetrics.recall,
    f1Score: detMetrics.f1Score,
    mAP50: detMetrics.mAP50,
    mAP50_95: detMetrics.mAP50_95,
    meanIoU: detMetrics.meanIoU,
    avgLatencyMs,
    p95LatencyMs,
    confusionLabels: detMetrics.confusionLabels,
    confusionFlat: detMetrics.confusionFlat,
    perClassMetrics: detMetrics.perClassMetrics,
    samples,
  };
}
