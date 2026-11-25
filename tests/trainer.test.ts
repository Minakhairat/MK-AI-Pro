import test from 'node:test';
import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs';
import {
  buildClassificationModel,
  buildGridYoloModel,
  computeClassificationMetrics,
  computeDetectionMetrics,
  computeIoU,
  computeLatencyPercentiles,
  decodeGridDetections,
  DETECTION_GRID_SIZE,
  encodeGridTargets,
  getRecommendedHyperparameters,
  runOverfittingSanityTest,
  trainClassifierCore,
  trainDetectorCore,
} from '../src/lib/tfTrainer.ts';
import {
  generateIntegrationSnippets,
  generateModelCardReport,
} from '../src/lib/localModelStore.ts';
import type { BoundingBox, TrainedModel } from '../src/types/domain.ts';

test('buildClassificationModel trains via real backpropagation and lowers loss across epochs', async () => {
  await tf.ready();
  const classes = ['bright', 'dark'];
  const inputSize = 32;
  const model = buildClassificationModel('mk_mobilenet_sep', inputSize, classes.length);

  // Separable real tensors: 2 bright images (val ~0.9), 2 dark images (val ~0.1)
  const bright = tf.fill([2, inputSize, inputSize, 3], 0.9);
  const dark = tf.fill([2, inputSize, inputSize, 3], 0.1);
  const xTrain = tf.concat([bright, dark], 0) as tf.Tensor4D;
  const yTrainIdx = [0, 0, 1, 1];
  const yTrainOH = tf.oneHot(tf.tensor1d(yTrainIdx, 'int32'), 2) as tf.Tensor2D;

  const hp = {
    ...getRecommendedHyperparameters('image_classification', 4),
    epochs: 3,
    batchSize: 2,
    learningRate: 0.02,
    inputSize,
    earlyStoppingPatience: 0,
    saveCheckpoints: false,
  };

  try {
    const result = await trainClassifierCore({
      model,
      xTrain,
      yTrainOneHot: yTrainOH,
      xVal: xTrain,
      yValOneHot: yTrainOH,
      yValIndices: yTrainIdx,
      classes,
      hyperparameters: hp,
      hooks: {
        shouldPause: () => false,
        shouldCancel: () => false,
        onEpoch: () => {},
        onLog: () => {},
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.epochMetrics.length, 3);
    assert.ok(result.epochMetrics[2].trainLoss <= result.epochMetrics[0].trainLoss + 0.05);
    assert.ok(result.bestValMetric >= 0.5);
    assert.equal(result.diagnostics.hasNonZeroGradients, true);
    assert.equal(result.diagnostics.parametersUpdated, true);
    assert.equal(result.diagnostics.allLossesFinite, true);
    assert.ok(result.diagnostics.epoch1ParamDelta > 0);
  } finally {
    bright.dispose();
    dark.dispose();
    xTrain.dispose();
    yTrainOH.dispose();
    model.dispose();
  }
});

test('runOverfittingSanityTest overfits small separable classification and detection subsets with real gradient updates', async () => {
  await tf.ready();
  const inputSize = 32;
  const bright = tf.fill([2, inputSize, inputSize, 3], 0.92);
  const dark = tf.fill([2, inputSize, inputSize, 3], 0.08);
  const xSubset = tf.concat([bright, dark], 0) as tf.Tensor4D;
  const yIndices = [0, 0, 1, 1];
  const yOH = tf.oneHot(tf.tensor1d(yIndices, 'int32'), 2) as tf.Tensor2D;

  try {
    const clsSanity = await runOverfittingSanityTest({
      taskType: 'image_classification',
      architecture: 'mk_mobilenet_sep',
      classes: ['bright', 'dark'],
      xSubset,
      ySubsetOneHot: yOH,
      ySubsetIndices: yIndices,
      inputSize,
      steps: 18,
      learningRate: 0.015,
    });

    assert.equal(clsSanity.passed, true);
    assert.equal(clsSanity.hasNonZeroGradients, true);
    assert.ok(clsSanity.paramDelta > 0);
    assert.ok(clsSanity.lossReductionPct > 30);
    assert.ok(clsSanity.subsetAccuracy >= 0.9);
  } finally {
    bright.dispose();
    dark.dispose();
    xSubset.dispose();
    yOH.dispose();
  }

  // Object detection sanity test
  const xDet = tf.randomUniform([2, inputSize, inputSize, 3], 0, 1) as tf.Tensor4D;
  const boxesSubset: BoundingBox[][] = [
    [{ id: 'sb1', className: 'obj', x: 0.15, y: 0.15, width: 0.3, height: 0.3 }],
    [{ id: 'sb2', className: 'obj', x: 0.55, y: 0.55, width: 0.3, height: 0.3 }],
  ];
  try {
    const detSanity = await runOverfittingSanityTest({
      taskType: 'object_detection',
      architecture: 'mk_yolo_grid',
      classes: ['obj'],
      xSubset: xDet,
      boxesSubset,
      inputSize,
      steps: 14,
      learningRate: 0.006,
    });
    assert.equal(detSanity.hasNonZeroGradients, true);
    assert.ok(detSanity.paramDelta > 0);
    assert.ok(detSanity.finalLoss < detSanity.initialLoss);
  } finally {
    xDet.dispose();
  }
});

test('Classifier model serialization round-trip preserves exact predictions', async () => {
  await tf.ready();
  const inputSize = 32;
  const model = buildClassificationModel('mk_convnet_deep', inputSize, 2);
  const sample = tf.randomUniform([1, inputSize, inputSize, 3], 0, 1) as tf.Tensor4D;

  let savedArtifacts: tf.io.ModelArtifacts | null = null;
  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      savedArtifacts = artifacts;
      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON',
        },
      };
    })
  );

  assert.ok(savedArtifacts);
  const reloaded = await tf.loadLayersModel(tf.io.fromMemory(savedArtifacts));

  try {
    const before = Array.from((model.predict(sample) as tf.Tensor).dataSync());
    const after = Array.from((reloaded.predict(sample) as tf.Tensor).dataSync());
    assert.equal(before.length, after.length);
    for (let i = 0; i < before.length; i++) {
      assert.ok(Math.abs(before[i] - after[i]) < 1e-6);
    }
  } finally {
    sample.dispose();
    model.dispose();
    reloaded.dispose();
  }
});

test('trainDetectorCore executes real grid YOLO gradient updates and supports pause/cancel gates', async () => {
  await tf.ready();
  const classes = ['box'];
  const inputSize = 32;
  const model = buildGridYoloModel(inputSize, classes.length, DETECTION_GRID_SIZE);

  const xTrain = tf.randomUniform([2, inputSize, inputSize, 3], 0, 1) as tf.Tensor4D;
  const gtBoxes: BoundingBox[][] = [
    [{ id: 'b1', className: 'box', x: 0.2, y: 0.2, width: 0.3, height: 0.3 }],
    [{ id: 'b2', className: 'box', x: 0.5, y: 0.5, width: 0.25, height: 0.25 }],
  ];
  const yTargets = encodeGridTargets(gtBoxes, classes, DETECTION_GRID_SIZE);

  const hp = {
    ...getRecommendedHyperparameters('object_detection', 2),
    epochs: 2,
    batchSize: 2,
    learningRate: 0.005,
    inputSize,
    earlyStoppingPatience: 0,
    saveCheckpoints: false,
  };

  try {
    const res = await trainDetectorCore({
      model,
      xTrain,
      yTrainTargets: yTargets,
      trainGroundTruth: gtBoxes,
      xVal: xTrain,
      yValTargets: yTargets,
      valGroundTruth: gtBoxes,
      classes,
      hyperparameters: hp,
      gridSize: DETECTION_GRID_SIZE,
      hooks: {
        shouldPause: () => false,
        shouldCancel: () => false,
        onEpoch: () => {},
        onLog: () => {},
      },
    });
    assert.equal(res.status, 'completed');
    assert.equal(res.epochMetrics.length, 2);
    assert.ok(Number.isFinite(res.epochMetrics[0].trainLoss));
    assert.equal(res.diagnostics.hasNonZeroGradients, true);
    assert.equal(res.diagnostics.parametersUpdated, true);
  } finally {
    xTrain.dispose();
    yTargets.dispose();
    model.dispose();
  }
});

test('computeClassificationMetrics & computeDetectionMetrics produce exact Precision/Recall/F1/ErrorRate/mAP50_95/meanIoU', () => {
  const clsStats = computeClassificationMetrics([0, 0, 1, 1], [0, 1, 1, 1], ['cat', 'dog']);
  assert.equal(clsStats.accuracy, 0.75);
  assert.equal(clsStats.errorRate, 0.25);
  assert.deepEqual(clsStats.confusionFlat, [1, 1, 0, 2]);
  assert.equal(clsStats.perClassMetrics[0].recall, 0.5);
  assert.equal(clsStats.perClassMetrics[1].precision, 0.6667);

  assert.equal(
    Number(computeIoU({ x: 0, y: 0, width: 0.5, height: 0.5 }, { x: 0.25, y: 0, width: 0.5, height: 0.5 }).toFixed(4)),
    0.3333
  );

  const detStats = computeDetectionMetrics(
    [[{ id: 'g1', className: 'defect', x: 0.1, y: 0.1, width: 0.4, height: 0.4 }]],
    [[{ className: 'defect', classIndex: 0, confidence: 0.9, x: 0.1, y: 0.1, width: 0.4, height: 0.4 }]],
    ['defect'],
    0.5
  );
  assert.equal(detStats.precision, 1);
  assert.equal(detStats.recall, 1);
  assert.equal(detStats.mAP50, 1);
  assert.ok(detStats.mAP50_95 >= 0.9 && detStats.mAP50_95 <= 1);
  assert.equal(detStats.meanIoU, 1);

  // Grid decoder smoke test
  const raw = new Float32Array(5 * 5 * 6).fill(-10);
  raw[0 * 6 + 4] = 8; // high objectness in cell (0,0)
  raw[0 * 6 + 5] = 8; // class 0 high logit
  const decoded = decodeGridDetections(raw, ['defect'], 5, 0.3, 0.5);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].className, 'defect');
});

test('Phase 4 latency percentiles, model card exports, and inference snippets generate exact output', () => {
  const stats = computeLatencyPercentiles([10, 20, 30, 40, 100]);
  assert.equal(stats.avgLatencyMs, 40);
  assert.equal(stats.p95LatencyMs, 100);
  assert.deepEqual(computeLatencyPercentiles([]), { avgLatencyMs: 0, p95LatencyMs: 0 });

  const sampleModel: TrainedModel = {
    id: 'mdl_test_1',
    runId: 'run_test_1',
    projectId: 'proj_1',
    datasetId: 'ds_1',
    datasetVersion: 2,
    ownerUid: 'user_1',
    name: 'PCB Defect Detector v2',
    taskType: 'object_detection',
    backendEngine: 'tfjs_browser',
    architecture: 'mk_yolo_grid',
    license: 'Apache-2.0 (In-Browser)',
    classes: ['scratch', 'missing_pin'],
    inputSize: 128,
    parameterCount: 64500,
    weightSizeBytes: 258000,
    inferenceLatencyMs: 14.5,
    accuracy: 0.91,
    precision: 0.9,
    recall: 0.88,
    f1Score: 0.89,
    mAP50: 0.91,
    confusionLabels: ['scratch', 'missing_pin', '__background__'],
    confusionFlat: [9, 0, 1, 0, 8, 1, 1, 0, 0],
    perClassMetrics: [
      { className: 'scratch', precision: 0.9, recall: 0.9, f1Score: 0.9, support: 10 },
      { className: 'missing_pin', precision: 1.0, recall: 0.8889, f1Score: 0.9412, support: 9 },
    ],
    onDeviceCompatible: true,
    isActive: true,
  };

  const card = generateModelCardReport(sampleModel, null);
  const parsed = JSON.parse(card.json);
  assert.equal(parsed.model.id, 'mdl_test_1');
  assert.equal(parsed.evaluation.mAP50, 0.91);
  assert.match(card.csv, /scratch,0\.9,0\.9,0\.9,10/);
  assert.match(card.csv, /SUMMARY/);

  const snippets = generateIntegrationSnippets(sampleModel);
  assert.match(snippets.browserTs, /INPUT_SIZE = 128/);
  assert.match(snippets.browserTs, /"scratch","missing_pin"/);
  assert.match(snippets.pythonPy, /TASK_TYPE = "object_detection"/);
});
