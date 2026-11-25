import * as tf from '@tensorflow/tfjs';
import { renderAugmentationPreview } from './datasetUtils.ts';
import { getMediaBlob } from './localMediaStore.ts';
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
    epochs: taskType === 'image_classification' ? 12 : 16,
    batchSize,
    learningRate: taskType === 'image_classification' ? 0.0015 : 0.002,
    optimizer: 'adam',
    inputSize: taskType === 'image_classification' ? 96 : 128,
    confidenceThreshold: 0.35,
    iouThreshold: 0.5,
    earlyStoppingPatience: 5,
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
      })
    );
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

    model.add(
      tf.layers.conv2d({
        filters: 48,
        kernelSize: 3,
        padding: 'same',
        activation: 'relu',
      })
    );
    model.add(tf.layers.batchNormalization());
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

    model.add(
      tf.layers.conv2d({
        filters: 64,
        kernelSize: 3,
        padding: 'same',
        activation: 'relu',
      })
    );
    model.add(tf.layers.globalAveragePooling2d({}));
    model.add(tf.layers.dropout({ rate: 0.25 }));
    model.add(tf.layers.dense({ units: 48, activation: 'relu' }));
    model.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
    return model;
  }

  // Default: mk_mobilenet_sep (Depthwise-Separable CNN)
  model.add(
    tf.layers.conv2d({
      inputShape: [inputSize, inputSize, 3],
      filters: 16,
      kernelSize: 3,
      strides: 2,
      padding: 'same',
      activation: 'relu',
    })
  );
  model.add(tf.layers.batchNormalization());

  model.add(
    tf.layers.separableConv2d({
      filters: 32,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.separableConv2d({
      filters: 64,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
    })
  );
  model.add(tf.layers.globalAveragePooling2d({}));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
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
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.conv2d({
      filters: 32,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.conv2d({
      filters: 48,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  model.add(
    tf.layers.conv2d({
      filters: 48,
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
    })
  );
  model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));

  if (inputSize >= 128) {
    model.add(tf.layers.maxPooling2d({ poolSize: 2, strides: 2 }));
  }

  model.add(tf.layers.flatten());
  model.add(tf.layers.dropout({ rate: 0.15 }));
  model.add(
    tf.layers.dense({
      units: gridSize * gridSize * (5 + numClasses),
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

  return {
    accuracy: Number(accuracy.toFixed(4)),
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
        if (gtClassIdx >= 0) {
          matrix[gtClassIdx * mSize + pred.classIndex] += 1;
        }
        if (pred.classIndex === gtClassIdx) {
          tpByClass[pred.classIndex] += 1;
          predsScoresByClass[pred.classIndex].push({ conf: pred.confidence, tp: true });
        } else {
          fpByClass[pred.classIndex] += 1;
          predsScoresByClass[pred.classIndex].push({ conf: pred.confidence, tp: false });
        }
      } else {
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
  const mAP50 = activeClasses > 0 ? apSum / activeClasses : 0;

  return {
    precision: Number(macroP.toFixed(4)),
    recall: Number(macroR.toFixed(4)),
    f1Score: Number(macroF1.toFixed(4)),
    mAP50: Number(mAP50.toFixed(4)),
    confusionLabels: labelsWithBg,
    confusionFlat: matrix,
    perClassMetrics,
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
}> {
  const { model, xTrain, yTrainOneHot, xVal, yValOneHot, yValIndices, classes, hyperparameters, hooks } =
    params;

  const optimizer = createOptimizer(hyperparameters.optimizer, hyperparameters.learningRate);
  model.compile({
    optimizer,
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });

  const epochMetrics: EpochMetricPoint[] = [];
  let bestEpoch = 0;
  let bestValMetric = -1;
  let staleEpochs = 0;
  let bestWeights: tf.Tensor[] | null = null;

  for (let epoch = 1; epoch <= hyperparameters.epochs; epoch++) {
    const gate = await waitWhilePaused(hooks);
    if (gate === 'cancel') {
      bestWeights?.forEach((w) => w.dispose());
      return { status: 'cancelled', epochMetrics, bestEpoch: Math.max(1, bestEpoch), bestValMetric: Math.max(0, bestValMetric) };
    }

    const t0 = performance.now();
    const history = await model.fit(xTrain, yTrainOneHot, {
      epochs: 1,
      batchSize: Math.min(hyperparameters.batchSize, xTrain.shape[0]),
      shuffle: true,
      validationData: [xVal, yValOneHot],
      verbose: 0,
    });

    const trainLoss = Number(history.history.loss?.[0] ?? 0);
    const valLoss = Number(history.history.val_loss?.[0] ?? trainLoss);
    const trainAcc = Number(history.history.acc?.[0] ?? history.history.accuracy?.[0] ?? 0);

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

    if (valAcc >= bestValMetric) {
      bestValMetric = valAcc;
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
      ).toFixed(1)}% (${durationMs}ms)`
    );
    await hooks.onEpoch(point, bestEpoch, Math.max(0, bestValMetric));

    if (
      hyperparameters.earlyStoppingPatience > 0 &&
      staleEpochs >= hyperparameters.earlyStoppingPatience &&
      epoch >= 5
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

    const clsLossRaw = tf.losses.softmaxCrossEntropy(trueCls, predClsLogits);
    const batchCount = tf.maximum(1, tf.cast(preds.shape[0], 'float32'));
    const posCount = tf.maximum(1, tf.sum(objMask));

    const coordLoss = tf.div(tf.mul(5, tf.add(xyLoss, whLoss)), posCount);
    const objLoss = tf.div(tf.add(posObjLoss, tf.mul(0.25, negObjLoss)), batchCount);

    return tf.add(tf.add(coordLoss, objLoss), clsLossRaw) as tf.Scalar;
  });
}

export async function trainDetectorCore(params: {
  model: tf.LayersModel;
  xTrain: tf.Tensor4D;
  yTrainTargets: tf.Tensor4D;
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
}> {
  const {
    model,
    xTrain,
    yTrainTargets,
    xVal,
    yValTargets,
    valGroundTruth,
    classes,
    hyperparameters,
    gridSize = DETECTION_GRID_SIZE,
    hooks,
  } = params;

  const optimizer = createOptimizer(hyperparameters.optimizer, hyperparameters.learningRate);
  const trainableVars = model.trainableWeights.map((w) => w.read() as tf.Variable);
  const nTrain = xTrain.shape[0];
  const batchSize = Math.min(hyperparameters.batchSize, nTrain);
  const epochMetrics: EpochMetricPoint[] = [];
  let bestEpoch = 0;
  let bestValMetric = -1;
  let staleEpochs = 0;
  let bestWeights: tf.Tensor[] | null = null;

  for (let epoch = 1; epoch <= hyperparameters.epochs; epoch++) {
    const gate = await waitWhilePaused(hooks);
    if (gate === 'cancel') {
      bestWeights?.forEach((w) => w.dispose());
      return { status: 'cancelled', epochMetrics, bestEpoch: Math.max(1, bestEpoch), bestValMetric: Math.max(0, bestValMetric) };
    }

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
        return { status: 'cancelled', epochMetrics, bestEpoch: Math.max(1, bestEpoch), bestValMetric: Math.max(0, bestValMetric) };
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

        optimizer.applyGradients(grads);
        return value.dataSync()[0];
      });

      epochLossSum += lossVal;
      batchSteps += 1;
      await tf.nextFrame();
    }

    const avgTrainLoss = epochLossSum / Math.max(1, batchSteps);

    const valEval = tf.tidy(() => {
      const predVal = model.predict(xVal) as tf.Tensor4D;
      const valLoss = computeYoloBatchLoss(predVal, yValTargets, classes.length).dataSync()[0];
      const predData = predVal.dataSync() as Float32Array;
      return { valLoss, predData: new Float32Array(predData) };
    });

    const perCellStride = gridSize * gridSize * (5 + classes.length);
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
      trainMetric: Number(detStats.f1Score.toFixed(4)),
      valMetric: Number(detStats.mAP50.toFixed(4)),
      durationMs,
    };
    epochMetrics.push(point);

    if (detStats.mAP50 >= bestValMetric) {
      bestValMetric = detStats.mAP50;
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
      `Epoch ${epoch}/${hyperparameters.epochs} — loss: ${point.trainLoss.toFixed(4)} · mAP@50: ${(
        detStats.mAP50 * 100
      ).toFixed(1)}% · F1: ${(detStats.f1Score * 100).toFixed(1)}% (${durationMs}ms)`
    );
    await hooks.onEpoch(point, bestEpoch, Math.max(0, bestValMetric));

    if (
      hyperparameters.earlyStoppingPatience > 0 &&
      staleEpochs >= hyperparameters.earlyStoppingPatience &&
      epoch >= 5
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
  };
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
    canvas.width = inputSize;
    canvas.height = inputSize;

    if (augmentConfig) {
      renderAugmentationPreview(canvas, img, {
        ...augmentConfig,
        resizeWidth: inputSize,
        resizeHeight: inputSize,
      });
    } else {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, inputSize, inputSize);
      }
    }

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
  precision: number;
  recall: number;
  f1Score: number;
  mAP50: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
  hardwareSummary: string;
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

  const isAnnotated = (item: DatasetItem) =>
    params.taskType === 'image_classification'
      ? item.classificationLabel.trim().length > 0 && classes.includes(item.classificationLabel)
      : item.annotations.some((b) => classes.includes(b.className));

  const trainItems = params.items.filter((it) => it.split === 'train' && isAnnotated(it));
  const valItemsRaw = params.items.filter((it) => it.split === 'val' && isAnnotated(it));
  const testItemsRaw = params.items.filter((it) => it.split === 'test' && isAnnotated(it));

  if (trainItems.length < 2) {
    throw new Error('At least 2 annotated images in the Train split are required to start real training.');
  }

  const valItems = valItemsRaw.length > 0 ? valItemsRaw : trainItems.slice(0, Math.max(1, Math.floor(trainItems.length / 3)));
  const evaluatedSplit: 'test' | 'val' = testItemsRaw.length > 0 ? 'test' : 'val';
  const testItems = testItemsRaw.length > 0 ? testItemsRaw : valItems;

  params.hooks.onLog(
    `Loaded splits — Train: ${trainItems.length} (augmented), Val: ${valItems.length} (clean), Test: ${testItems.length} (clean)`
  );

  const loadSplitTensors = async (splitItems: DatasetItem[], applyTrainAug: boolean) => {
    const tensors: tf.Tensor3D[] = [];
    const validItems: DatasetItem[] = [];
    for (const item of splitItems) {
      const blob = await getMediaBlob(item.id);
      if (!blob) continue;
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
      // Apply augmentation strictly to Train split only (Anti-Leakage rule)
      const tensor = await blobToNormalizedTensor(
        blob,
        params.hyperparameters.inputSize,
        augForTask
      );
      tensors.push(tensor);
      validItems.push(item);
    }
    if (tensors.length === 0) {
      throw new Error('No local image blobs found in IndexedDB for this dataset split.');
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
            precision: 0,
            recall: 0,
            f1Score: 0,
            mAP50: 0,
            confusionLabels: [],
            confusionFlat: [],
            perClassMetrics: [],
            hardwareSummary,
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
          precision: evalMetrics.precision,
          recall: evalMetrics.recall,
          f1Score: evalMetrics.f1Score,
          mAP50: 0,
          confusionLabels: evalMetrics.confusionLabels,
          confusionFlat: evalMetrics.confusionFlat,
          perClassMetrics: evalMetrics.perClassMetrics,
          hardwareSummary,
        };
      } finally {
        yTrainOH.dispose();
        yValOH.dispose();
      }
    } else {
      // Object Detection: mk_yolo_grid
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
            precision: 0,
            recall: 0,
            f1Score: 0,
            mAP50: 0,
            confusionLabels: [],
            confusionFlat: [],
            perClassMetrics: [],
            hardwareSummary,
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
          precision: detMetrics.precision,
          recall: detMetrics.recall,
          f1Score: detMetrics.f1Score,
          mAP50: detMetrics.mAP50,
          confusionLabels: detMetrics.confusionLabels,
          confusionFlat: detMetrics.confusionFlat,
          perClassMetrics: detMetrics.perClassMetrics,
          hardwareSummary,
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
      precision: clsMetrics.precision,
      recall: clsMetrics.recall,
      f1Score: clsMetrics.f1Score,
      mAP50: 0,
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
    precision: detMetrics.precision,
    recall: detMetrics.recall,
    f1Score: detMetrics.f1Score,
    mAP50: detMetrics.mAP50,
    avgLatencyMs,
    p95LatencyMs,
    confusionLabels: detMetrics.confusionLabels,
    confusionFlat: detMetrics.confusionFlat,
    perClassMetrics: detMetrics.perClassMetrics,
    samples,
  };
}
