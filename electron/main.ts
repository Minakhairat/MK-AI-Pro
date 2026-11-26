import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DesktopConfig,
  DesktopRuntimeInfo,
  ExecutionProfile,
  InstallerType,
} from '../src/types/desktop.ts';
import { DependencyManager } from './services/dependencyManager.ts';
import { LocalEngineManager } from './services/engineManager.ts';
import { HardwareDetector } from './services/hardwareDetector.ts';
import { DesktopModelDownloadManager } from './services/modelDownloadManager.ts';
import { PythonRuntimeManager } from './services/pythonRuntimeManager.ts';
import { SetupWizardRunner } from './services/setupWizardRunner.ts';
import { DesktopStorageManager, resolveConfinedPath } from './services/storageManager.ts';
import { DesktopSyncService } from './services/syncService.ts';
import { DesktopUpdateManager } from './services/updateManager.ts';

let mainWindow: BrowserWindow | null = null;
let storageManager: DesktopStorageManager;
let runtimeManager: PythonRuntimeManager;
let hardwareDetector: HardwareDetector;
let dependencyManager: DependencyManager;
let engineManager: LocalEngineManager;
let modelDownloadManager: DesktopModelDownloadManager;
let updateManager: DesktopUpdateManager;
let setupWizardRunner: SetupWizardRunner;
let syncService: DesktopSyncService;

const SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!SINGLE_INSTANCE_LOCK) {
  app.quit();
}

function getBundledResourcesRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, '..');
}

function resolveAiEngineDir(): string {
  return path.join(getBundledResourcesRoot(), 'ai_engine');
}

function resolveBundledPythonDir(): string | null {
  const candidates = [
    path.join(getBundledResourcesRoot(), 'python-bundle'),
    path.join(getBundledResourcesRoot(), 'build', 'python-bundle'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function resolveOfflineWheelhouseDir(): string | null {
  const candidates = [
    path.join(getBundledResourcesRoot(), 'wheelhouse'),
    path.join(getBundledResourcesRoot(), 'build', 'wheelhouse'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function detectInstallerType(): InstallerType {
  if (resolveOfflineWheelhouseDir() || process.env.OFFLINE_INSTALLER === '1') {
    return 'offline';
  }
  return 'online';
}

function validateIpcSender(event: Electron.IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || '';
  if (
    senderUrl.startsWith('file://') ||
    senderUrl.startsWith('http://localhost:3000') ||
    senderUrl.startsWith('http://127.0.0.1:3000')
  ) {
    return;
  }
  throw new Error(`Blocked unauthorized IPC sender origin: ${senderUrl || 'unknown'}`);
}

function registerSafeHandle<Args extends unknown[], Result>(
  channel: string,
  handler: (...args: Args) => Promise<Result> | Result
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    validateIpcSender(event);
    return handler(...(args as Args));
  });
}

function initServices(): void {
  const userDataRoot = app.getPath('userData');
  const aiEngineDir = resolveAiEngineDir();
  const manifestsDir = path.join(aiEngineDir, 'manifests');
  const versionsManifestPath = path.join(manifestsDir, 'versions.json');

  storageManager = new DesktopStorageManager(userDataRoot);
  runtimeManager = new PythonRuntimeManager({
    userDataRoot,
    bundledRuntimeDir: resolveBundledPythonDir(),
    versionsManifestPath,
  });
  hardwareDetector = new HardwareDetector();
  dependencyManager = new DependencyManager({
    runtimeManager,
    manifestsDir,
    offlineWheelhouseDir: resolveOfflineWheelhouseDir(),
  });
  engineManager = new LocalEngineManager({
    storage: storageManager,
    runtime: runtimeManager,
    aiEngineDir,
  });
  modelDownloadManager = new DesktopModelDownloadManager(storageManager);
  updateManager = new DesktopUpdateManager({
    appVersion: app.getVersion(),
    versionsManifestPath,
    engine: engineManager,
    weights: modelDownloadManager,
  });
  setupWizardRunner = new SetupWizardRunner({
    storage: storageManager,
    runtime: runtimeManager,
    hardware: hardwareDetector,
    deps: dependencyManager,
    engine: engineManager,
  });
  syncService = new DesktopSyncService(storageManager);
}

function registerIpcHandlers(): void {
  registerSafeHandle('desktop:get-runtime-info', async (): Promise<DesktopRuntimeInfo> => {
    const probe = await runtimeManager.inspectRuntime();
    let engineVersion = '2.1.0-desktop';
    try {
      const manifestRaw = fs.readFileSync(
        path.join(resolveAiEngineDir(), 'manifests', 'versions.json'),
        'utf8'
      );
      const parsed = JSON.parse(manifestRaw) as { aiEngineVersion?: string };
      if (parsed.aiEngineVersion) engineVersion = parsed.aiEngineVersion;
    } catch {
      // fallback default
    }
    return {
      isDesktop: true,
      appVersion: app.getVersion(),
      engineVersion,
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
      installerType: detectInstallerType(),
      pythonRuntimeReady: probe.ready,
      pythonExecutable: probe.pythonExecutable,
      pythonVersion: probe.pythonVersion,
      venvPath: probe.venvPath,
      storageRoot: storageManager.getStorageRoot(),
    };
  });

  registerSafeHandle('desktop:get-config', () => storageManager.getConfig());

  registerSafeHandle('desktop:update-config', (patch: Partial<DesktopConfig>) =>
    storageManager.updateConfig(patch)
  );

  registerSafeHandle('desktop:select-storage-dir', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select MK-AI-Data Root Directory',
      defaultPath: storageManager.getStorageRoot(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const chosen = res.filePaths[0];
    storageManager.updateConfig({ storageRoot: chosen });
    return chosen;
  });

  registerSafeHandle('desktop:open-storage-folder', async () => {
    const root = storageManager.getStorageRoot();
    storageManager.ensureStructure();
    const errMsg = await shell.openPath(root);
    return { opened: !errMsg, path: root };
  });

  registerSafeHandle('desktop:detect-hardware', async (forceRefresh: boolean = false) => {
    const probe = await runtimeManager.inspectRuntime();
    return hardwareDetector.detect({
      pythonExe: probe.pythonExecutable,
      storageRoot: storageManager.getStorageRoot(),
      forceRefresh: Boolean(forceRefresh),
    });
  });

  registerSafeHandle('desktop:audit-python', (profile?: ExecutionProfile) =>
    dependencyManager.auditEnvironment(profile ?? 'cpu')
  );

  registerSafeHandle(
    'desktop:install-repair-python',
    (opts: { profile?: ExecutionProfile; extras?: string[]; repair?: boolean } = {}) =>
      dependencyManager.installOrRepair({
        profile: opts.profile ?? 'cpu',
        extras: opts.extras,
        repair: opts.repair,
        onProgress: (progress) => {
          mainWindow?.webContents.send('deps:progress', progress);
        },
      })
  );

  registerSafeHandle(
    'desktop:run-setup-wizard',
    (opts: { profile?: ExecutionProfile } = {}) =>
      setupWizardRunner.run(
        { profile: opts.profile, autoInstallIfMissing: true },
        (state) => {
          mainWindow?.webContents.send('setup:progress', state);
        }
      )
  );

  registerSafeHandle('desktop:get-setup-wizard-state', () => setupWizardRunner.getState());

  registerSafeHandle('desktop:get-engine-status', () => engineManager.getStatus());
  registerSafeHandle('desktop:restart-engine', () => engineManager.restart());
  registerSafeHandle('desktop:stop-engine', () => engineManager.stop());

  registerSafeHandle('desktop:probe-engine-capabilities', async () => {
    const st = await engineManager.getStatus();
    if (!st.healthy) {
      await engineManager.start();
    }
    return engineManager.requestJson('/capabilities');
  });

  registerSafeHandle('desktop:start-training-job', async (payload: Record<string, unknown>) => {
    const cfg = storageManager.getConfig();
    const st = await engineManager.getStatus();
    if (!st.healthy) {
      await engineManager.start();
    }
    return engineManager.requestJson('/training/jobs', {
      method: 'POST',
      body: {
        ...payload,
        preferredDevice: cfg.selectedDevice,
      },
      timeoutMs: 30000,
    });
  });

  registerSafeHandle('desktop:fetch-training-job', (jobId: string) =>
    engineManager.requestJson(`/training/jobs/${encodeURIComponent(jobId)}`)
  );

  registerSafeHandle(
    'desktop:control-training-job',
    (params: { jobId: string; action: 'pause' | 'resume' | 'cancel' }) =>
      engineManager.requestJson(
        `/training/jobs/${encodeURIComponent(params.jobId)}/${params.action}`,
        { method: 'POST' }
      )
  );

  registerSafeHandle(
    'desktop:stage-dataset',
    (params: Parameters<DesktopStorageManager['stageDatasetForTraining']>[0]) =>
      storageManager.stageDatasetForTraining(params)
  );

  registerSafeHandle('desktop:get-storage-usage', () => storageManager.getUsageSummary());
  registerSafeHandle('desktop:clear-temp-cache', () => storageManager.clearTempCache());
  registerSafeHandle('desktop:create-backup', (label?: string) =>
    storageManager.createBackupSnapshot(label)
  );

  registerSafeHandle('desktop:list-weights', () => modelDownloadManager.listWeights());
  registerSafeHandle(
    'desktop:download-weight',
    (params: Parameters<DesktopModelDownloadManager['downloadWeight']>[0]) =>
      modelDownloadManager.downloadWeight(params)
  );
  registerSafeHandle('desktop:rollback-weight', (catalogModelId: string) =>
    modelDownloadManager.rollbackWeight(catalogModelId)
  );

  registerSafeHandle('desktop:check-updates', () => {
    const cfg = storageManager.getConfig();
    return updateManager.checkUpdates(cfg.updateChannel);
  });

  registerSafeHandle('desktop:export-diagnostics', async () => {
    const probe = await runtimeManager.inspectRuntime();
    const hw = await hardwareDetector.detect({
      pythonExe: probe.pythonExecutable,
      storageRoot: storageManager.getStorageRoot(),
      forceRefresh: true,
    });
    const engine = await engineManager.getStatus();
    const storage = storageManager.getUsageSummary();
    const syncInfo = syncService.compareWithCloudRecords([]);
    const wizard = setupWizardRunner.getState();

    const reportObj = {
      generatedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      installerType: detectInstallerType(),
      pythonRuntime: probe,
      hardware: hw,
      engine,
      storage,
      sync: syncInfo,
      wizard,
    };
    const reportJson = JSON.stringify(reportObj, null, 2);
    const outPath = resolveConfinedPath(
      storageManager.getSubdir('logs'),
      `mk-ai-diagnostics-${Date.now()}.json`
    );
    fs.writeFileSync(outPath, reportJson, 'utf8');
    return { savedPath: outPath, reportJson };
  });

  registerSafeHandle('desktop:save-project-meta', (project: Record<string, unknown>) =>
    storageManager.saveProjectMetadata(project)
  );
  registerSafeHandle('desktop:list-project-meta', () => storageManager.listProjectMetadata());
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090b',
    title: 'MK AI Desktop — MK Tech',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devUrl = process.env.MK_DESKTOP_DEV_URL;
  if (devUrl && (devUrl.startsWith('http://localhost:') || devUrl.startsWith('http://127.0.0.1:'))) {
    void mainWindow.loadURL(devUrl);
  } else {
    const indexHtml = path.resolve(__dirname, '..', 'dist', 'index.html');
    void mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  initServices();
  registerIpcHandlers();
  createWindow();

  const cfg = storageManager.getConfig();
  if (cfg.autoStartEngine && cfg.firstLaunchCompleted) {
    void engineManager.start().catch(() => {});
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

let quittingCleanupDone = false;
app.on('before-quit', (e) => {
  if (quittingCleanupDone) return;
  const cfg = storageManager?.getConfig();
  if (cfg?.stopEngineOnExit && engineManager) {
    e.preventDefault();
    quittingCleanupDone = true;
    void engineManager.stop().finally(() => {
      app.quit();
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
