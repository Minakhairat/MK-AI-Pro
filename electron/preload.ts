import { contextBridge, ipcRenderer } from 'electron';
import type {
  DependencyInstallProgress,
  MkDesktopApi,
  SetupWizardState,
} from '../src/types/desktop.ts';

const api: MkDesktopApi = {
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:get-runtime-info'),
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  updateConfig: (patch) => ipcRenderer.invoke('desktop:update-config', patch),
  selectStorageDirectory: () => ipcRenderer.invoke('desktop:select-storage-dir'),
  openStorageFolder: () => ipcRenderer.invoke('desktop:open-storage-folder'),
  detectHardware: (forceRefresh = false) =>
    ipcRenderer.invoke('desktop:detect-hardware', forceRefresh),
  auditPythonEnvironment: (profile) => ipcRenderer.invoke('desktop:audit-python', profile),
  installOrRepairPythonEnv: (opts) => ipcRenderer.invoke('desktop:install-repair-python', opts),
  runSetupWizard: (opts) => ipcRenderer.invoke('desktop:run-setup-wizard', opts),
  getSetupWizardState: () => ipcRenderer.invoke('desktop:get-setup-wizard-state'),
  getEngineStatus: () => ipcRenderer.invoke('desktop:get-engine-status'),
  getEngineTokenStatus: () => ipcRenderer.invoke('desktop:get-engine-token-status'),
  rotateEngineToken: () => ipcRenderer.invoke('desktop:rotate-engine-token'),
  restartEngine: () => ipcRenderer.invoke('desktop:restart-engine'),
  stopEngine: () => ipcRenderer.invoke('desktop:stop-engine'),
  probeLocalEngineCapabilities: () => ipcRenderer.invoke('desktop:probe-engine-capabilities'),
  startLocalTrainingJob: (payload) => ipcRenderer.invoke('desktop:start-training-job', payload),
  fetchLocalTrainingJob: (jobId) => ipcRenderer.invoke('desktop:fetch-training-job', jobId),
  controlLocalTrainingJob: (jobId, action) =>
    ipcRenderer.invoke('desktop:control-training-job', { jobId, action }),
  stageDatasetForLocalTraining: (params) => ipcRenderer.invoke('desktop:stage-dataset', params),
  getStorageUsage: () => ipcRenderer.invoke('desktop:get-storage-usage'),
  clearTempCache: () => ipcRenderer.invoke('desktop:clear-temp-cache'),
  createBackupSnapshot: (label) => ipcRenderer.invoke('desktop:create-backup', label),
  listLocalWeights: () => ipcRenderer.invoke('desktop:list-weights'),
  downloadWeightArtifact: (params) => ipcRenderer.invoke('desktop:download-weight', params),
  rollbackWeightArtifact: (catalogModelId) =>
    ipcRenderer.invoke('desktop:rollback-weight', catalogModelId),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  exportDiagnosticReport: () => ipcRenderer.invoke('desktop:export-diagnostics'),
  saveLocalProjectMetadata: (project) => ipcRenderer.invoke('desktop:save-project-meta', project),
  listLocalProjectMetadata: () => ipcRenderer.invoke('desktop:list-project-meta'),
  onSetupProgress: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SetupWizardState) => cb(state);
    ipcRenderer.on('setup:progress', handler);
    return () => ipcRenderer.removeListener('setup:progress', handler);
  },
  onDependencyProgress: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DependencyInstallProgress) =>
      cb(progress);
    ipcRenderer.on('deps:progress', handler);
    return () => ipcRenderer.removeListener('deps:progress', handler);
  },
};

contextBridge.exposeInMainWorld('mkDesktop', api);
