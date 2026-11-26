import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getManifestFilenameForProfile,
  parseRequirementsManifest,
  DependencyManager,
} from '../electron/services/dependencyManager.ts';
import { findFreeLoopbackPort, LocalEngineManager } from '../electron/services/engineManager.ts';
import {
  HardwareDetector,
  parseNvidiaSmiCsv,
  selectExecutionProfile,
} from '../electron/services/hardwareDetector.ts';
import { validateWeightDownloadUrl } from '../electron/services/modelDownloadManager.ts';
import { PythonRuntimeManager } from '../electron/services/pythonRuntimeManager.ts';
import { SetupWizardRunner } from '../electron/services/setupWizardRunner.ts';
import {
  DesktopStorageManager,
  STORAGE_SUBDIRS,
  resolveConfinedPath,
} from '../electron/services/storageManager.ts';
import { DesktopSyncService, detectSyncConflicts } from '../electron/services/syncService.ts';
import { compareSemver } from '../electron/services/updateManager.ts';
import { evaluateModelHardwareCompatibility } from '../src/lib/hardwareCompatibility.ts';
import { MODEL_CATALOG } from '../src/lib/modelRegistry.ts';
import type { HardwareReport } from '../src/types/desktop.ts';

function makeTempWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('DesktopStorageManager initializes all 10 subdirs, blocks path escape, stages datasets, clears cache, and backs up', () => {
  const root = makeTempWorkspace('mk-ai-desktop-storage-');
  try {
    const configDir = path.join(root, 'userData');
    const dataRoot = path.join(root, 'MK-AI-Data');
    const storage = new DesktopStorageManager(configDir, dataRoot);

    for (const sub of STORAGE_SUBDIRS) {
      assert.equal(fs.existsSync(path.join(dataRoot, sub)), true, `Missing subdir ${sub}`);
    }

    assert.throws(() => resolveConfinedPath(dataRoot, '..', 'escape.txt'), /confinement/i);

    // Stage Classification dataset
    const clsStaged = storage.stageDatasetForTraining({
      datasetId: 'ds_cls_1',
      taskType: 'image_classification',
      classes: ['ok', 'defect'],
      classificationImages: [
        {
          itemId: 'img_1',
          split: 'train',
          className: 'ok',
          filename: 'img_1.jpg',
          mimeType: 'image/jpeg',
          base64Data: Buffer.from('fakejpg').toString('base64'),
        },
      ],
    });
    assert.equal(clsStaged.stagedCount, 1);
    assert.equal(clsStaged.datasetYamlPath, null);
    assert.equal(fs.existsSync(path.join(clsStaged.datasetDirPath, 'train', 'ok', 'img_1.jpg')), true);

    // Stage Detection YOLO dataset + data.yaml
    const detStaged = storage.stageDatasetForTraining({
      datasetId: 'ds_det_1',
      taskType: 'object_detection',
      classes: ['scratch', 'dent'],
      detectionImages: [
        {
          itemId: 'det_1',
          split: 'train',
          filename: 'det_1.jpg',
          mimeType: 'image/jpeg',
          base64Data: Buffer.from('fakejpg').toString('base64'),
          boxes: [{ classIndex: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
        },
      ],
    });
    assert.equal(detStaged.stagedCount, 1);
    assert.ok(detStaged.datasetYamlPath && fs.existsSync(detStaged.datasetYamlPath));
    const yaml = fs.readFileSync(detStaged.datasetYamlPath, 'utf8');
    assert.match(yaml, /nc: 2/);
    assert.match(yaml, /0: "scratch"/);

    // Temp cleanup & Backup snapshot
    fs.writeFileSync(path.join(storage.getSubdir('temp'), 'junk.tmp'), '123456');
    const cleared = storage.clearTempCache();
    assert.ok(cleared.clearedBytes >= 6);

    storage.saveProjectMetadata({ id: 'proj_1', name: 'PCB Inspection' });
    const backup = storage.createBackupSnapshot('test');
    assert.equal(fs.existsSync(path.join(backup.backupPath, 'backup-manifest.json')), true);
    assert.equal(fs.existsSync(path.join(backup.backupPath, 'projects', 'proj_1.json')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('HardwareDetector parses NVIDIA SMI CSV and selects accurate execution profiles without faking CUDA', () => {
  const gpu = parseNvidiaSmiCsv('NVIDIA GeForce RTX 4070, 12288, 11400, 551.61\n');
  assert.equal(gpu.available, true);
  assert.equal(gpu.gpuName, 'NVIDIA GeForce RTX 4070');
  assert.equal(gpu.memoryTotalMb, 12288);
  assert.equal(gpu.driverVersion, '551.61');

  const noGpu = parseNvidiaSmiCsv('');
  assert.equal(noGpu.available, false);

  assert.equal(
    selectExecutionProfile({
      nvidiaGpuAvailable: true,
      driverCompatible: true,
      pytorchInstalled: true,
      pytorchCudaAvailable: true,
      totalRamGb: 16,
    }),
    'nvidia_gpu'
  );
  assert.equal(
    selectExecutionProfile({
      nvidiaGpuAvailable: false,
      driverCompatible: false,
      pytorchInstalled: true,
      pytorchCudaAvailable: false,
      totalRamGb: 16,
    }),
    'cpu'
  );
  assert.equal(
    selectExecutionProfile({
      nvidiaGpuAvailable: false,
      driverCompatible: false,
      pytorchInstalled: false,
      pytorchCudaAvailable: false,
      totalRamGb: 3,
    }),
    'safe_compatibility'
  );
});

test('DependencyManager manifest parser & profile filenames work accurately', () => {
  const cuFile = path.join(process.cwd(), 'ai_engine', 'manifests', getManifestFilenameForProfile('nvidia_gpu'));
  assert.equal(fs.existsSync(cuFile), true);
  const parsed = parseRequirementsManifest(fs.readFileSync(cuFile, 'utf8'));
  assert.equal(parsed.extraIndexUrl, 'https://download.pytorch.org/whl/cu121');
  assert.ok(parsed.packages.some((p) => p.name === 'torch' && p.importName === 'torch'));
  assert.ok(parsed.packages.some((p) => p.name === 'pillow' && p.importName === 'PIL'));
});

test('LocalEngineManager loopback port discovery, Weight URL allowlist, and Semver comparator', async () => {
  const port = await findFreeLoopbackPort(0);
  assert.ok(port >= 1024 && port <= 65535);

  const okUrl = validateWeightDownloadUrl('https://huggingface.co/mktech/yolov11n/resolve/main/model.pt');
  assert.equal(okUrl.protocol, 'https:');
  assert.throws(() => validateWeightDownloadUrl('http://huggingface.co/model.pt'), /HTTPS/i);
  assert.throws(() => validateWeightDownloadUrl('https://evil.example.com/model.pt'), /Untrusted/i);
  assert.throws(
    () => validateWeightDownloadUrl('https://github.com/org/repo/../secret.pt'),
    /traversal/i
  );

  assert.equal(compareSemver('2.1.0', '2.0.5'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('1.2.0', '1.10.0'), -1);
});

test('SetupWizardRunner reports honest failure rather than simulating success when Python runtime is absent', async () => {
  const root = makeTempWorkspace('mk-ai-wizard-test-');
  try {
    const configDir = path.join(root, 'userData');
    const dataRoot = path.join(root, 'MK-AI-Data');
    const manifestsDir = path.join(process.cwd(), 'ai_engine', 'manifests');
    const storage = new DesktopStorageManager(configDir, dataRoot);
    const runtime = new PythonRuntimeManager({
      userDataRoot: configDir,
      versionsManifestPath: path.join(manifestsDir, 'versions.json'),
    });
    const hardware = new HardwareDetector();
    const deps = new DependencyManager({ runtimeManager: runtime, manifestsDir });
    const engine = new LocalEngineManager({
      storage,
      runtime,
      aiEngineDir: path.join(process.cwd(), 'ai_engine'),
    });
    const wizard = new SetupWizardRunner({ storage, runtime, hardware, deps, engine });

    const result = await wizard.run({ profile: 'cpu', autoInstallIfMissing: false });
    assert.equal(result.completed, true);
    assert.equal(result.overallReady, false);
    const pyStep = result.steps.find((s) => s.id === 'python_runtime');
    assert.equal(pyStep?.status, 'failed');
    assert.equal(pyStep?.recoverable, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('DesktopSyncService enforces explicit cloudSyncConsentGranted and detects conflicts', () => {
  const root = makeTempWorkspace('mk-ai-sync-test-');
  try {
    const storage = new DesktopStorageManager(path.join(root, 'cfg'), path.join(root, 'data'));
    const sync = new DesktopSyncService(storage);
    assert.equal(sync.canSyncToCloud().allowed, false);

    storage.updateConfig({ cloudSyncConsentGranted: true });
    assert.equal(sync.canSyncToCloud().allowed, true);

    const conflicts = detectSyncConflicts(
      [{ entityType: 'project', entityId: 'p1', name: 'Welding', updatedAt: '2026-11-26T10:00:00.000Z' }],
      [{ entityType: 'project', entityId: 'p1', name: 'Welding', updatedAt: '2026-11-26T10:05:00.000Z' }]
    );
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].resolution, 'pending');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('evaluateModelHardwareCompatibility accurately flags CPU-only warnings and missing PyTorch blocks', () => {
  const yolo = MODEL_CATALOG.find((m) => m.id === 'yolo11s')!;
  const mobilenet = MODEL_CATALOG.find((m) => m.id === 'mobilenet_v1_025_imagenet')!;

  const cpuNoTorch: HardwareReport = {
    detectedAt: new Date().toISOString(),
    osPlatform: 'win32',
    osVersion: 'Windows 11',
    cpuModel: 'Intel Core i5',
    cpuArch: 'x64',
    physicalCores: 4,
    logicalProcessors: 8,
    totalRamGb: 8,
    availableRamGb: 5,
    freeDiskGb: 80,
    nvidiaGpuAvailable: false,
    nvidiaGpuName: null,
    gpuMemoryTotalMb: 0,
    gpuMemoryFreeMb: 0,
    nvidiaDriverVersion: null,
    cudaDriverVersion: null,
    pytorchInstalled: false,
    pytorchVersion: null,
    pytorchCudaAvailable: false,
    torchvisionVersion: null,
    ultralyticsInstalled: false,
    ultralyticsVersion: null,
    timmInstalled: false,
    timmVersion: null,
    transformersInstalled: false,
    onnxruntimeInstalled: false,
    onnxruntimeVersion: null,
    recommendedProfile: 'cpu',
    warnings: [],
  };

  const browserCompat = evaluateModelHardwareCompatibility(mobilenet, cpuNoTorch);
  assert.equal(browserCompat.compatible, true);
  assert.equal(browserCompat.recommendedDevice, 'browser_webgl');

  const yoloBlocked = evaluateModelHardwareCompatibility(yolo, cpuNoTorch);
  assert.equal(yoloBlocked.compatible, false);
  assert.equal(yoloBlocked.severity, 'blocked');
});
