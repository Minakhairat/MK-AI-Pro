import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
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
import {
  EngineTokenManager,
  computeTokenFingerprint,
  createElectronSafeStorageBackend,
  isValidEngineToken,
} from '../electron/services/tokenManager.ts';
import { compareSemver } from '../electron/services/updateManager.ts';
import {
  getDesktopReleasesUrl,
  parseGitHubReleasePayload,
  parseSha256SumsText,
} from '../src/lib/desktopRelease.ts';
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

test('EngineTokenManager auto-provisions, encrypts, repairs corrupted stores, rotates without leaking plaintext, and redacts logs', () => {
  const root = makeTempWorkspace('mk-ai-token-test-');
  try {
    const userData = path.join(root, 'userData');
    const storage = new DesktopStorageManager(userData, path.join(root, 'MK-AI-Data'));
    const manager1 = new EngineTokenManager({ userDataRoot: userData });
    storage.setRedactor((line) => manager1.redactSecret(line));

    // 1. Auto-generate cryptographically random token on first launch
    const first = manager1.ensureToken();
    assert.equal(first.created, true);
    assert.equal(first.repaired, false);
    assert.equal(isValidEngineToken(first.token), true);
    assert.equal(first.status.tokenProtected, true);
    assert.equal(first.status.fingerprintSha256Prefix, computeTokenFingerprint(first.token));

    // Public status and stored file must never contain plaintext secret
    const credFile = path.join(userData, 'security', 'mk-engine-credential.dat');
    assert.equal(fs.existsSync(credFile), true);
    const credRaw = fs.readFileSync(credFile, 'utf8');
    assert.equal(credRaw.includes(first.token), false);
    assert.equal(JSON.stringify(first.status).includes(first.token), false);

    // 2. Reload persisted token from encrypted store in fresh instance
    const manager2 = new EngineTokenManager({ userDataRoot: userData });
    const reloaded = manager2.ensureToken();
    assert.equal(reloaded.token, first.token);
    assert.equal(reloaded.created, false);
    assert.equal(reloaded.repaired, false);

    // 3. Log redaction scrubs raw token and Bearer headers
    storage.appendLog(
      'ai-engine.log',
      `Header Authorization: Bearer ${first.token} MK_ENGINE_TOKEN=${first.token}`
    );
    const logContents = fs.readFileSync(path.join(storage.getSubdir('logs'), 'ai-engine.log'), 'utf8');
    assert.equal(logContents.includes(first.token), false);
    assert.match(logContents, /\[REDACTED_ENGINE_TOKEN\]/);

    // 4. Corrupt credential file -> automatic repair regenerates valid token
    fs.writeFileSync(credFile, '{ "version": 1, "encryptedPayloadBase64": "corrupt!!!" }', 'utf8');
    const manager3 = new EngineTokenManager({ userDataRoot: userData });
    const repaired = manager3.ensureToken();
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.status.repairCount, 1);
    assert.notEqual(repaired.token, first.token);
    assert.equal(isValidEngineToken(repaired.token), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('LocalEngineManager live-synchronizes token rotation with FastAPI server and auto-repairs on 401 mismatch', async () => {
  const root = makeTempWorkspace('mk-ai-engine-rot-test-');
  let server: http.Server | null = null;
  try {
    const userData = path.join(root, 'userData');
    const dataRoot = path.join(root, 'MK-AI-Data');
    const manifestsDir = path.join(process.cwd(), 'ai_engine', 'manifests');
    const storage = new DesktopStorageManager(userData, dataRoot);
    const runtime = new PythonRuntimeManager({
      userDataRoot: userData,
      versionsManifestPath: path.join(manifestsDir, 'versions.json'),
    });
    const tokenManager = new EngineTokenManager({ userDataRoot: userData });
    const initial = tokenManager.ensureToken();

    let serverActiveToken = initial.token;
    server = http.createServer((req, res) => {
      const auth = req.headers.authorization || '';
      const authed = auth === `Bearer ${serverActiveToken}`;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'online',
              version: '2.1.0-test',
              token_protected: true,
              token_configured: true,
              ...(authed ? { hardware: { cpu_count: 4 } } : {}),
            })
          );
          return;
        }
        if (!authed) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'Missing or invalid local engine bearer token.' }));
          return;
        }
        if (req.url === '/security/rotate-token' && req.method === 'POST') {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { new_token: string };
          serverActiveToken = parsed.new_token;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ rotated: true, token_protected: true }));
          return;
        }
        if (req.url === '/capabilities') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ supported_architectures: ['mobilenet_v2'] }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');

    const engine = new LocalEngineManager({
      storage,
      runtime,
      aiEngineDir: path.join(process.cwd(), 'ai_engine'),
      tokenManager,
    });
    engine.setPortForTesting(addr.port);

    // Health check validates token protection cleanly
    const healthBefore = await engine.checkHealth();
    assert.equal(healthBefore.healthy, true);
    assert.equal(healthBefore.tokenConfigured, true);
    assert.ok(healthBefore.hardware);

    // Rotate and live-sync token with running engine server
    const rotated = await engine.rotateAndSyncToken();
    assert.equal(rotated.engineSynced, true);
    assert.equal(rotated.restarted, false);
    assert.notEqual(
      rotated.status.fingerprintSha256Prefix,
      initial.status.fingerprintSha256Prefix
    );

    // Authenticated request works immediately using newly rotated token
    const caps = await engine.requestJson<{ supported_architectures: string[] }>('/capabilities');
    assert.deepEqual(caps.supported_architectures, ['mobilenet_v2']);

    // Simulate external/out-of-sync server rejecting token with 401 -> automatic token repair triggers
    serverActiveToken = 'different_desynced_token_value_1234567890';
    await assert.rejects(
      () => engine.requestJson('/capabilities'),
      /Missing or invalid local engine|REDACTED_ENGINE_TOKEN/i
    );
    assert.equal(engine.getTokenStatus().repairCount, 1);
    assert.equal(engine.getTokenStatus().lastRepairReason, 'rejected_or_missing_engine_token');
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Security Audit: AES-256-GCM fallback requires separate master key, OS vault upgrades cleanly on recovery, and concurrent rotation causes zero dropped requests', async () => {
  const root = makeTempWorkspace('mk-ai-sec-audit-');
  let srv: http.Server | null = null;
  try {
    const userData = path.join(root, 'userData');
    const dataRoot = path.join(root, 'MK-AI-Data');
    const manifestsDir = path.join(process.cwd(), 'ai_engine', 'manifests');
    const storage = new DesktopStorageManager(userData, dataRoot);
    const runtime = new PythonRuntimeManager({
      userDataRoot: userData,
      versionsManifestPath: path.join(manifestsDir, 'versions.json'),
    });

    // Preserve sample dataset to verify credential cleanup never deletes user datasets
    fs.writeFileSync(path.join(storage.getSubdir('datasets'), 'keep.txt'), 'dataset-content');

    // 1. OS vault unavailable -> AES-256-GCM with dedicated 0o600 master key (cannot decrypt from hostname+user+path alone)
    let vaultAvailable = false;
    const mockVault = {
      isEncryptionAvailable: () => vaultAvailable,
      encryptString: (s: string) => Buffer.from(`VAULT:${Buffer.from(s).toString('base64')}`),
      decryptString: (b: Buffer) => {
        const text = b.toString('utf8');
        if (!text.startsWith('VAULT:')) throw new Error('Vault mismatch');
        return Buffer.from(text.slice(6), 'base64').toString('utf8');
      },
    };

    const mFallback = new EngineTokenManager({
      userDataRoot: userData,
      backend: createElectronSafeStorageBackend(mockVault),
    });
    const fallbackRes = mFallback.ensureToken();
    assert.equal(fallbackRes.status.protectionMode, 'restricted_local_store');

    const credPath = path.join(userData, 'security', 'mk-engine-credential.dat');
    const masterKeyPath = path.join(userData, 'security', 'mk-engine-master.key');
    assert.equal(fs.existsSync(masterKeyPath), true);

    const env = JSON.parse(fs.readFileSync(credPath, 'utf8')) as {
      encryptedPayloadBase64: string;
      ivBase64: string;
      authTagBase64: string;
      saltHex: string;
    };
    const predictableOnlyKey = crypto.scryptSync(
      `${os.hostname()}|${os.userInfo().username}|${path.join(userData, 'security')}`,
      env.saltHex,
      32
    );
    assert.throws(() => {
      const dec = crypto.createDecipheriv(
        'aes-256-gcm',
        predictableOnlyKey,
        Buffer.from(env.ivBase64, 'base64')
      );
      dec.setAuthTag(Buffer.from(env.authTagBase64, 'base64'));
      dec.update(Buffer.from(env.encryptedPayloadBase64, 'base64'));
      dec.final();
    });

    // 2. OS vault becomes available again -> seamlessly upgrades fallback token to OS DPAPI/Keychain & deletes legacy master key
    vaultAvailable = true;
    const mRecovered = new EngineTokenManager({
      userDataRoot: userData,
      backend: createElectronSafeStorageBackend(mockVault),
    });
    const recoveredRes = mRecovered.ensureToken();
    assert.equal(recoveredRes.token, fallbackRes.token);
    assert.equal(recoveredRes.status.protectionMode, 'os_dpapi_keychain');
    assert.equal(fs.existsSync(masterKeyPath), false);

    // 3. Concurrent requests during live token rotation experience 0 failed calls & 0 repairs
    let serverTok = recoveredRes.token;
    let unauthHits = 0;
    srv = http.createServer((req, res) => {
      const auth = req.headers.authorization || '';
      const ok = auth === `Bearer ${serverTok}`;
      if (!ok) {
        unauthHits += 1;
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Invalid token' }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        if (req.url === '/security/rotate-token') {
          setTimeout(() => {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { new_token: string };
            serverTok = parsed.new_token;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ rotated: true, token_protected: true }));
          }, 30);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ supported_architectures: ['yolo11n'] }));
      });
    });

    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
    const addr = srv.address();
    assert.ok(addr && typeof addr === 'object');

    const engine = new LocalEngineManager({
      storage,
      runtime,
      aiEngineDir: path.join(process.cwd(), 'ai_engine'),
      tokenManager: mRecovered,
    });
    engine.setPortForTesting(addr.port);

    const [rotOut, ...callOuts] = await Promise.all([
      engine.rotateAndSyncToken(),
      ...Array.from({ length: 12 }, () => engine.requestJson('/capabilities')),
    ]);
    assert.equal(rotOut.engineSynced, true);
    assert.equal(unauthHits, 0);
    assert.equal(callOuts.length, 12);
    assert.equal(engine.getTokenStatus().repairCount, 0);

    // Old token must be rejected after rotation; new token succeeds
    const oldCall = await fetch(`http://127.0.0.1:${addr.port}/capabilities`, {
      headers: { Authorization: `Bearer ${recoveredRes.token}` },
    });
    assert.equal(oldCall.status, 401);

    // 4. Uninstall credential wipe removes credentials without deleting MK-AI-Data datasets
    mRecovered.clearCredentials();
    assert.equal(fs.existsSync(credPath), false);
    assert.equal(fs.existsSync(path.join(storage.getSubdir('datasets'), 'keep.txt')), true);
  } finally {
    if (srv) {
      srv.closeAllConnections?.();
      await new Promise<void>((r) => srv!.close(() => r()));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Desktop GitHub Release pipeline validates real MK-AI-Setup.exe assets and never redirects to broken /actions', () => {
  const releasesUrl = getDesktopReleasesUrl('mk-tech/MK-AI-Pro');
  assert.equal(releasesUrl, 'https://github.com/mk-tech/MK-AI-Pro/releases/latest');
  assert.equal(releasesUrl.includes('/actions'), false);

  const shaMap = parseSha256SumsText(
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  MK-AI-Setup.exe\n'
  );
  assert.equal(
    shaMap['MK-AI-Setup.exe'],
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  );

  // Valid published release with verified GitHub download URL -> available
  const validRel = parseGitHubReleasePayload(
    {
      draft: false,
      prerelease: false,
      tag_name: 'v1.0.0',
      name: 'MK AI Desktop v1.0.0',
      published_at: '2026-11-26T00:00:00Z',
      body: 'Official Windows release.',
      assets: [
        {
          name: 'MK-AI-Setup.exe',
          size: 98_500_000,
          browser_download_url:
            'https://github.com/mk-tech/MK-AI-Pro/releases/download/v1.0.0/MK-AI-Setup.exe',
        },
      ],
    },
    'mk-tech/MK-AI-Pro',
    shaMap
  );
  assert.equal(validRel.available, true);
  assert.equal(validRel.status, 'available');
  assert.equal(validRel.installerAsset?.name, 'MK-AI-Setup.exe');
  assert.equal(validRel.installerAsset?.sha256, shaMap['MK-AI-Setup.exe']);

  // Missing .exe asset or draft release or untrusted download host -> honest Coming Soon state
  const emptyRel = parseGitHubReleasePayload({ draft: false, assets: [] }, 'mk-tech/MK-AI-Pro');
  assert.equal(emptyRel.available, false);
  assert.equal(emptyRel.status, 'coming_soon');
  assert.equal(emptyRel.installerAsset, null);

  const untrustedRel = parseGitHubReleasePayload(
    {
      draft: false,
      assets: [
        {
          name: 'MK-AI-Setup.exe',
          size: 1000,
          browser_download_url: 'https://evil.example.com/MK-AI-Setup.exe',
        },
      ],
    },
    'mk-tech/MK-AI-Pro'
  );
  assert.equal(untrustedRel.available, false);
  assert.equal(untrustedRel.installerAsset, null);
});
