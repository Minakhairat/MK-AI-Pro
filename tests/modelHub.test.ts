import test from 'node:test';
import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs';
import {
  buildSameDatasetComparisonRows,
  checkWorkerCompatibility,
  getPreprocessModeForArchitecture,
  MODEL_CATALOG,
} from '../src/lib/modelRegistry.ts';
import { recommendModelsForProject } from '../src/lib/modelRecommender.ts';
import {
  resolveCheckpointShardUrl,
  validateCheckpointUrl,
} from '../src/lib/pretrainedWeightManager.ts';
import {
  buildPretrainedTransferClassifier,
  computeScheduledLearningRate,
  disposeCompositeAndBaseModel,
  getRecommendedHyperparameters,
  runOverfittingSanityTest,
  trainClassifierCore,
} from '../src/lib/tfTrainer.ts';
import {
  buildPortableBundlePayload,
  generateIntegrationSnippets,
  verifyExportedBundleReload,
} from '../src/lib/localModelStore.ts';
import type { TrainedModel } from '../src/types/domain.ts';

test('MODEL_CATALOG integrity enforces inference_only non-trainability and neg1_pos1 preprocessing on MobileNetV1', () => {
  const inferenceOnly = MODEL_CATALOG.filter((m) => m.tierStatus === 'inference_only');
  assert.ok(inferenceOnly.length >= 4);
  for (const spec of inferenceOnly) {
    assert.equal(
      spec.capabilities.training,
      false,
      `${spec.id} is inference_only and must not advertise training=true`
    );
  }

  const tfjsPretrained = MODEL_CATALOG.filter(
    (m) => m.backendEngine === 'tfjs_browser' && m.pretrainedAvailable
  );
  assert.ok(tfjsPretrained.length >= 4);
  for (const spec of tfjsPretrained) {
    assert.ok(spec.checkpointUrl?.startsWith('https://storage.googleapis.com/tfjs-models/'));
    if (spec.supportedTasks.includes('image_classification')) {
      assert.equal(spec.preprocessMode, 'neg1_pos1');
    }
  }
});

test('validateCheckpointUrl and resolveCheckpointShardUrl reject insecure origins and path traversal', () => {
  const valid = validateCheckpointUrl(
    'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json'
  );
  assert.equal(valid.hostname, 'storage.googleapis.com');

  const shard = resolveCheckpointShardUrl(valid, 'group1-shard1of1');
  assert.equal(
    shard.toString(),
    'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/group1-shard1of1'
  );

  assert.throws(() =>
    validateCheckpointUrl('http://storage.googleapis.com/tfjs-models/tfjs/x/model.json')
  );
  assert.throws(() => validateCheckpointUrl('https://evil.example/tfjs-models/model.json'));
  assert.throws(() =>
    validateCheckpointUrl(
      'https://storage.googleapis.com/tfjs-models/../secret/model.json'
    )
  );
  assert.throws(() => resolveCheckpointShardUrl(valid, '../other/shard1'));
  assert.throws(() => resolveCheckpointShardUrl(valid, 'https://evil.example/shard1'));
});

test('recommendModelsForProject prioritizes MobileNetV1 frozen_head for small browser datasets and checks Python worker deps', () => {
  const browserRecs = recommendModelsForProject({
    taskType: 'image_classification',
    sampleCount: 30,
    classCount: 3,
    targetDevice: 'browser',
    priority: 'balanced',
    workerCapabilities: {
      reachable: false,
      torchInstalled: false,
      torchvisionInstalled: false,
      ultralyticsInstalled: false,
      timmInstalled: false,
      transformersInstalled: false,
      onnxInstalled: false,
      onnxruntimeInstalled: false,
      paddleocrInstalled: false,
      cudaAvailable: false,
      mpsAvailable: false,
      cpuCount: 0,
      supportedArchitectures: [],
    },
  });

  assert.ok(browserRecs.length > 0);
  assert.equal(browserRecs[0].compatible, true);
  assert.equal(browserRecs[0].spec.backendEngine, 'tfjs_browser');
  assert.equal(browserRecs[0].spec.pretrainedAvailable, true);
  assert.equal(browserRecs[0].recommendedConfig.fineTuningStrategy, 'frozen_head');

  const convnext = MODEL_CATALOG.find((m) => m.id === 'convnextv2_tiny')!;
  const offlineCheck = checkWorkerCompatibility(convnext, null);
  assert.equal(offlineCheck.compatible, false);

  const onlineMissingTimm = checkWorkerCompatibility(convnext, {
    reachable: true,
    torchInstalled: true,
    torchvisionInstalled: true,
    ultralyticsInstalled: false,
    timmInstalled: false,
    transformersInstalled: false,
    onnxInstalled: false,
    onnxruntimeInstalled: false,
    paddleocrInstalled: false,
    cudaAvailable: true,
    mpsAvailable: false,
    cpuCount: 8,
    supportedArchitectures: [],
  });
  assert.equal(onlineMissingTimm.compatible, false);
  assert.deepEqual(onlineMissingTimm.missingPackages, ['timm']);
});

test('computeScheduledLearningRate applies constant, cosine annealing, and step decay accurately', () => {
  const baseLr = 0.001;
  assert.equal(computeScheduledLearningRate(baseLr, 5, 10, 'none'), baseLr);

  const cos1 = computeScheduledLearningRate(baseLr, 1, 10, 'cosine');
  const cosMid = computeScheduledLearningRate(baseLr, 5, 10, 'cosine');
  const cosEnd = computeScheduledLearningRate(baseLr, 10, 10, 'cosine');
  assert.ok(Math.abs(cos1 - baseLr) < 1e-9);
  assert.ok(cosMid < cos1 && cosMid > cosEnd);
  assert.ok(Math.abs(cosEnd - baseLr * 0.05) < 1e-6);

  const stepEarly = computeScheduledLearningRate(baseLr, 2, 10, 'step');
  const stepLate = computeScheduledLearningRate(baseLr, 5, 10, 'step');
  assert.equal(stepEarly, baseLr);
  assert.ok(Math.abs(stepLate - baseLr * 0.5) < 1e-9);
});

function createSyntheticMobileNetBackbone(inputSize: number): tf.LayersModel {
  const input = tf.input({ shape: [inputSize, inputSize, 3] });
  const conv1 = tf.layers
    .conv2d({
      name: 'conv1',
      filters: 8,
      kernelSize: 3,
      strides: 2,
      padding: 'same',
      activation: 'relu',
    })
    .apply(input);
  const bn1 = tf.layers
    .batchNormalization({ name: 'conv1_bn' })
    .apply(conv1);
  const conv2 = tf.layers
    .conv2d({
      name: 'conv_pw_13',
      filters: 16,
      kernelSize: 3,
      strides: 2,
      padding: 'same',
      activation: 'relu',
    })
    .apply(bn1);
  const gap = tf.layers
    .globalAveragePooling2d({ name: 'global_average_pooling2d_1' })
    .apply(conv2);
  const origHead = tf.layers
    .dense({ name: 'Logits', units: 10, activation: 'softmax' })
    .apply(gap) as tf.SymbolicTensor;
  return tf.model({ inputs: input, outputs: origHead });
}

test('buildPretrainedTransferClassifier trains frozen_head without modifying backbone and keeps BN frozen in partial_finetune', async () => {
  await tf.ready();
  const inputSize = 32;
  const classes = ['bright', 'dark'];

  // 1) Frozen backbone + trainable head
  const baseFrozen = createSyntheticMobileNetBackbone(inputSize);
  const conv1Before = await baseFrozen.getLayer('conv1').getWeights()[0].data();

  const builtFrozen = buildPretrainedTransferClassifier({
    baseModel: baseFrozen,
    numClasses: classes.length,
    strategy: 'frozen_head',
  });
  assert.equal(builtFrozen.unfrozenBackboneLayerCount, 0);

  const bright = tf.fill([4, inputSize, inputSize, 3], 0.85);
  const dark = tf.fill([4, inputSize, inputSize, 3], -0.85);
  const xTrain = tf.concat([bright, dark], 0) as tf.Tensor4D;
  const yIdx = [0, 0, 0, 0, 1, 1, 1, 1];
  const yOH = tf.oneHot(tf.tensor1d(yIdx, 'int32'), 2) as tf.Tensor2D;

  const hp = {
    ...getRecommendedHyperparameters('image_classification', 8),
    epochs: 8,
    batchSize: 4,
    learningRate: 0.02,
    inputSize,
    earlyStoppingPatience: 0,
    saveCheckpoints: false,
  };

  try {
    const res = await trainClassifierCore({
      model: builtFrozen.model,
      xTrain,
      yTrainOneHot: yOH,
      xVal: xTrain,
      yValOneHot: yOH,
      yValIndices: yIdx,
      classes,
      hyperparameters: hp,
      options: {
        fineTuningStrategy: 'frozen_head',
        scheduler: 'cosine',
        preprocessMode: 'neg1_pos1',
      },
      hooks: {
        shouldPause: () => false,
        shouldCancel: () => false,
        onEpoch: () => {},
        onLog: () => {},
      },
    });

    assert.equal(res.status, 'completed');
    assert.ok(res.epochMetrics[7].trainLoss < res.epochMetrics[0].trainLoss);
    assert.equal(res.diagnostics.hasNonZeroGradients, true);
    assert.equal(res.diagnostics.parametersUpdated, true);
    assert.ok(res.diagnostics.epoch1ParamDelta > 0);

    // Confirm backbone conv1 remained strictly untouched during frozen_head training
    const conv1After = await builtFrozen.model.getLayer('conv1').getWeights()[0].data();
    let maxDiff = 0;
    for (let i = 0; i < conv1Before.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(conv1After[i] - conv1Before[i]));
    }
    assert.equal(maxDiff, 0, 'Backbone weights must remain frozen in frozen_head strategy');

    // 2) Partial fine-tune must unfreeze top conv block while keeping BatchNorm frozen
    const basePartial = createSyntheticMobileNetBackbone(inputSize);
    const builtPartial = buildPretrainedTransferClassifier({
      baseModel: basePartial,
      numClasses: classes.length,
      strategy: 'partial_finetune',
    });
    assert.ok(builtPartial.unfrozenBackboneLayerCount > 0);
    assert.equal(builtPartial.model.getLayer('conv1_bn').trainable, false);
    builtPartial.model.dispose();
  } finally {
    bright.dispose();
    dark.dispose();
    xTrain.dispose();
    yOH.dispose();
    builtFrozen.model.dispose();
  }
});

test('runOverfittingSanityTest with pretrained baseModel and subsequent cleanup does not double-dispose conv1', async () => {
  await tf.ready();
  const inputSize = 32;
  const classes = ['bright', 'dark'];
  const baseModel = createSyntheticMobileNetBackbone(inputSize);
  const bright = tf.fill([3, inputSize, inputSize, 3], 0.85);
  const dark = tf.fill([3, inputSize, inputSize, 3], -0.85);
  const xSubset = tf.concat([bright, dark], 0) as tf.Tensor4D;
  const yIdx = [0, 0, 0, 1, 1, 1];
  const yOH = tf.oneHot(tf.tensor1d(yIdx, 'int32'), 2) as tf.Tensor2D;

  try {
    const res = await runOverfittingSanityTest({
      taskType: 'image_classification',
      architecture: 'mobilenet_v1_025_imagenet',
      classes,
      xSubset,
      ySubsetOneHot: yOH,
      ySubsetIndices: yIdx,
      inputSize,
      steps: 10,
      learningRate: 0.02,
      baseModel,
      fineTuningStrategy: 'frozen_head',
    });
    assert.equal(res.hasNonZeroGradients, true);
    assert.ok(res.finalLoss < res.initialLoss);
    // Simulate runDatasetOverfittingSanityTest finally cleanup after runOverfittingSanityTest
    disposeCompositeAndBaseModel(undefined, baseModel);
  } finally {
    bright.dispose();
    dark.dispose();
    xSubset.dispose();
    yOH.dispose();
  }
});

test('Portable bundle export preserves neg1_pos1 preprocessing and verifies reload parity', async () => {
  await tf.ready();
  assert.equal(getPreprocessModeForArchitecture('mobilenet_v1_025_imagenet'), 'neg1_pos1');
  assert.equal(getPreprocessModeForArchitecture('mk_mobilenet_sep'), 'zero_one');

  const input = tf.input({ shape: [32, 32, 3] });
  const gap = tf.layers.globalAveragePooling2d({}).apply(input);
  const out = tf.layers.dense({ units: 2, activation: 'softmax' }).apply(gap) as tf.SymbolicTensor;
  const model = tf.model({ inputs: input, outputs: out });

  let capturedTopology: unknown = null;
  let capturedSpecs: tf.io.WeightsManifestEntry[] = [];
  let capturedWeightData = new ArrayBuffer(0);

  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      capturedTopology = artifacts.modelTopology;
      capturedSpecs = artifacts.weightSpecs || [];
      capturedWeightData = artifacts.weightData as ArrayBuffer;
      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: 'JSON',
          weightDataBytes: capturedWeightData.byteLength,
        },
      };
    })
  );

  const meta: TrainedModel = {
    id: 'mdl_test_parity',
    runId: 'run_test_parity',
    projectId: 'proj_1',
    datasetId: 'ds_1',
    datasetVersion: 2,
    ownerUid: 'user_1',
    name: 'MobileNetV1 Test',
    taskType: 'image_classification',
    backendEngine: 'tfjs_browser',
    architecture: 'mobilenet_v1_025_imagenet',
    license: 'Apache-2.0',
    classes: ['pass', 'defect'],
    inputSize: 32,
    parameterCount: model.countParams(),
    weightSizeBytes: capturedWeightData.byteLength,
    inferenceLatencyMs: 4.2,
    accuracy: 0.92,
    precision: 0.92,
    recall: 0.92,
    f1Score: 0.92,
    mAP50: 0,
    confusionLabels: ['pass', 'defect'],
    confusionFlat: [5, 0, 1, 4],
    perClassMetrics: [],
    onDeviceCompatible: true,
    isActive: true,
  };

  try {
    const bundle = buildPortableBundlePayload(meta, {
      key: meta.id,
      projectId: meta.projectId,
      runId: meta.runId,
      classes: meta.classes,
      inputSize: meta.inputSize,
      taskType: 'image_classification',
      architecture: meta.architecture,
      preprocessMode: 'neg1_pos1',
      fineTuningStrategy: 'frozen_head',
      modelTopology: capturedTopology,
      weightSpecs: capturedSpecs,
      weightData: capturedWeightData,
      sizeBytes: capturedWeightData.byteLength,
      savedAt: new Date().toISOString(),
    });

    assert.equal(bundle.preprocessing.preprocessMode, 'neg1_pos1');
    assert.equal(bundle.preprocessing.normalization, 'neg1_to_1_[(px/127.5)-1]');

    const snippets = generateIntegrationSnippets(meta);
    assert.ok(snippets.browserTs.includes('.div(127.5).sub(1.0)'));
    assert.ok(snippets.pythonPy.includes('/ 127.5) - 1.0'));

    const reloaded = await verifyExportedBundleReload(JSON.stringify(bundle));
    assert.equal(reloaded.valid, true);
    assert.deepEqual(reloaded.outputShape, [1, 2]);

    const cmpRows = buildSameDatasetComparisonRows(
      [meta],
      [],
      'proj_1',
      'ds_1',
      3,
      'test'
    );
    assert.equal(cmpRows.length, 1);
    assert.equal(cmpRows[0].isMatchingSplit, false);
  } finally {
    model.dispose();
  }
});
