export type ExecutionProfile = 'nvidia_gpu' | 'cpu' | 'safe_compatibility';
export type InstallerType = 'online' | 'offline';
export type ExecutionTarget = 'browser_tfjs' | 'desktop_python' | 'cloud_python';

export interface DesktopConfig {
  storageRoot: string;
  autoStartEngine: boolean;
  stopEngineOnExit: boolean;
  preferredProfile: ExecutionProfile | 'auto';
  firstLaunchCompleted: boolean;
  cloudSyncConsentGranted: boolean;
  updateChannel: 'stable' | 'beta';
  selectedDevice: 'auto' | 'cpu' | 'cuda:0';
}

export interface DesktopRuntimeInfo {
  isDesktop: boolean;
  appVersion: string;
  engineVersion: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  installerType: InstallerType;
  pythonRuntimeReady: boolean;
  pythonExecutable: string | null;
  pythonVersion: string | null;
  venvPath: string | null;
  storageRoot: string;
}

export interface HardwareReport {
  detectedAt: string;
  osPlatform: string;
  osVersion: string;
  cpuModel: string;
  cpuArch: string;
  physicalCores: number;
  logicalProcessors: number;
  totalRamGb: number;
  availableRamGb: number;
  freeDiskGb: number;
  nvidiaGpuAvailable: boolean;
  nvidiaGpuName: string | null;
  gpuMemoryTotalMb: number;
  gpuMemoryFreeMb: number;
  nvidiaDriverVersion: string | null;
  cudaDriverVersion: string | null;
  pytorchInstalled: boolean;
  pytorchVersion: string | null;
  pytorchCudaAvailable: boolean;
  torchvisionVersion: string | null;
  ultralyticsInstalled: boolean;
  ultralyticsVersion: string | null;
  timmInstalled: boolean;
  timmVersion: string | null;
  transformersInstalled: boolean;
  onnxruntimeInstalled: boolean;
  onnxruntimeVersion: string | null;
  recommendedProfile: ExecutionProfile;
  warnings: string[];
}

export type SetupStepId =
  | 'sys_req'
  | 'python_runtime'
  | 'ai_deps'
  | 'hardware_detect'
  | 'pytorch_verify'
  | 'yolo_verify'
  | 'storage_init'
  | 'fastapi_start'
  | 'engine_e2e'
  | 'readiness_report';

export type SetupStepStatus = 'pending' | 'running' | 'passed' | 'warning' | 'failed' | 'skipped';

export interface SetupWizardStepResult {
  id: SetupStepId;
  order: number;
  titleEn: string;
  titleAr: string;
  status: SetupStepStatus;
  detail: string;
  recoverable: boolean;
  autoRepairAvailable: boolean;
  failureReason?: string;
  userActionEn?: string;
  userActionAr?: string;
  durationMs: number;
}

export interface SetupWizardState {
  running: boolean;
  completed: boolean;
  overallReady: boolean;
  selectedProfile: ExecutionProfile;
  steps: SetupWizardStepResult[];
  lastRunAt: string | null;
}

export interface PackageHealthEntry {
  name: string;
  requiredSpec: string;
  installedVersion: string | null;
  status: 'ok' | 'missing' | 'mismatch' | 'corrupted';
  requiredForProfile: boolean;
}

export interface DependencyInstallProgress {
  jobId: string;
  stage: 'idle' | 'downloading' | 'installing' | 'verifying' | 'rolling_back' | 'completed' | 'failed';
  profile: ExecutionProfile;
  progressPct: number;
  currentPackage: string;
  attempt: number;
  message: string;
  logs: string[];
}

export interface EngineTokenStatus {
  configured: boolean;
  tokenProtected: boolean;
  protectionMode: 'os_dpapi_keychain' | 'restricted_local_store';
  fingerprintSha256Prefix: string;
  createdAt: string | null;
  rotatedAt: string | null;
  lastVerifiedAt: string | null;
  lastRepairReason: string | null;
  repairCount: number;
}

export interface EngineRuntimeStatus {
  running: boolean;
  healthy: boolean;
  port: number | null;
  pid: number | null;
  version: string | null;
  restartCount: number;
  startedAt: string | null;
  lastError: string | null;
  tokenProtected: boolean;
  bindHost: string;
  tokenStatus?: EngineTokenStatus;
}

export type StorageSubdirName =
  | 'datasets'
  | 'projects'
  | 'models'
  | 'model_weights'
  | 'training_runs'
  | 'exports'
  | 'logs'
  | 'cache'
  | 'temp'
  | 'backups';

export interface StorageUsageSummary {
  storageRoot: string;
  totalUsedBytes: number;
  freeDiskBytes: number;
  totalDiskBytes: number;
  breakdownBytes: Record<StorageSubdirName, number>;
  datasetCount: number;
  modelCount: number;
  weightCount: number;
  backupCount: number;
}

export interface DesktopWeightRecord {
  id: string;
  catalogModelId: string;
  filename: string;
  localPath: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string;
  version: string;
  license: string;
  downloadedAt: string;
  previousVersionPath?: string;
}

export interface ComponentVersionEntry {
  component: 'desktop_app' | 'ai_engine' | 'python_deps' | 'model_registry' | 'model_weights';
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  compatible: boolean;
  releaseNotes: string;
  rollbackAvailable: boolean;
}

export interface UpdateCheckReport {
  checkedAt: string;
  channel: 'stable' | 'beta';
  offlineFallback: boolean;
  entries: ComponentVersionEntry[];
  error?: string;
}

export interface SyncConflictRecord {
  entityType: 'project' | 'dataset' | 'model';
  entityId: string;
  name: string;
  localUpdatedAt: string;
  cloudUpdatedAt: string;
  resolution: 'pending' | 'keep_local' | 'keep_cloud';
}

export interface ModelHardwareCompatibility {
  modelId: string;
  compatible: boolean;
  severity: 'ok' | 'warning' | 'blocked';
  recommendedDevice: 'cuda' | 'cpu' | 'browser_webgl' | 'unsupported';
  requiresDownload: boolean;
  warningsEn: string[];
  warningsAr: string[];
}

export interface StagedClassificationImageInput {
  itemId: string;
  split: 'train' | 'val' | 'test';
  className: string;
  filename: string;
  mimeType: string;
  base64Data: string;
}

export interface StagedDetectionImageInput {
  itemId: string;
  split: 'train' | 'val' | 'test';
  filename: string;
  mimeType: string;
  base64Data: string;
  boxes: { classIndex: number; x: number; y: number; width: number; height: number }[];
}

export interface DesktopStagedDatasetResult {
  datasetId: string;
  datasetDirPath: string;
  datasetYamlPath: string | null;
  stagedCount: number;
}

export interface PairingCodeChallenge {
  code: string;
  createdAt: string;
  expiresAt: string;
  relayUrl: string | null;
  relayEnabled: boolean;
}

export interface PairedDeviceSummary {
  deviceId: string;
  deviceName: string;
  pairedAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
  scopes: string[];
}

export interface PairingRelayStatus {
  enabled: boolean;
  listening: boolean;
  port: number | null;
  lanUrls: string[];
  activeChallenge: PairingCodeChallenge | null;
  devices: PairedDeviceSummary[];
}

export interface MkDesktopApi {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  getConfig: () => Promise<DesktopConfig>;
  updateConfig: (patch: Partial<DesktopConfig>) => Promise<DesktopConfig>;
  selectStorageDirectory: () => Promise<string | null>;
  openStorageFolder: () => Promise<{ opened: boolean; path: string }>;
  detectHardware: (forceRefresh?: boolean) => Promise<HardwareReport>;
  auditPythonEnvironment: (profile?: ExecutionProfile) => Promise<{
    pythonReady: boolean;
    isolatedVenv: boolean;
    packages: PackageHealthEntry[];
    issues: string[];
  }>;
  installOrRepairPythonEnv: (opts?: {
    profile?: ExecutionProfile;
    extras?: string[];
    repair?: boolean;
  }) => Promise<DependencyInstallProgress>;
  runSetupWizard: (opts?: { profile?: ExecutionProfile }) => Promise<SetupWizardState>;
  getSetupWizardState: () => Promise<SetupWizardState>;
  getEngineStatus: () => Promise<EngineRuntimeStatus>;
  getEngineTokenStatus: () => Promise<EngineTokenStatus>;
  rotateEngineToken: () => Promise<{
    status: EngineTokenStatus;
    engineSynced: boolean;
    restarted: boolean;
  }>;
  restartEngine: () => Promise<EngineRuntimeStatus>;
  stopEngine: () => Promise<EngineRuntimeStatus>;
  probeLocalEngineCapabilities: () => Promise<Record<string, unknown>>;
  startLocalTrainingJob: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchLocalTrainingJob: (jobId: string) => Promise<Record<string, unknown>>;
  controlLocalTrainingJob: (
    jobId: string,
    action: 'pause' | 'resume' | 'cancel'
  ) => Promise<Record<string, unknown>>;
  stageDatasetForLocalTraining: (params: {
    datasetId: string;
    taskType: 'image_classification' | 'object_detection';
    classes: string[];
    classificationImages?: StagedClassificationImageInput[];
    detectionImages?: StagedDetectionImageInput[];
  }) => Promise<DesktopStagedDatasetResult>;
  getStorageUsage: () => Promise<StorageUsageSummary>;
  clearTempCache: () => Promise<{ clearedBytes: number; summary: StorageUsageSummary }>;
  createBackupSnapshot: (label?: string) => Promise<{ backupPath: string; sizeBytes: number }>;
  listLocalWeights: () => Promise<DesktopWeightRecord[]>;
  downloadWeightArtifact: (params: {
    catalogModelId: string;
    url: string;
    expectedSha256?: string;
    license: string;
    version?: string;
  }) => Promise<DesktopWeightRecord>;
  rollbackWeightArtifact: (catalogModelId: string) => Promise<DesktopWeightRecord | null>;
  checkForUpdates: () => Promise<UpdateCheckReport>;
  exportDiagnosticReport: () => Promise<{ savedPath: string; reportJson: string }>;
  saveLocalProjectMetadata: (project: Record<string, unknown>) => Promise<{ ok: boolean }>;
  listLocalProjectMetadata: () => Promise<Record<string, unknown>[]>;
  getPairingStatus: () => Promise<PairingRelayStatus>;
  createPairingCode: () => Promise<PairingCodeChallenge>;
  setPairingRelayEnabled: (enabled: boolean) => Promise<PairingRelayStatus>;
  revokePairedDevice: (deviceId: string) => Promise<PairingRelayStatus>;
  onSetupProgress: (cb: (state: SetupWizardState) => void) => () => void;
  onDependencyProgress: (cb: (progress: DependencyInstallProgress) => void) => () => void;
}
