export type Locale = 'en' | 'ar';
export type ThemeMode = 'light' | 'dark';
export type PlanTier = 'free' | 'pro' | 'enterprise';
export type WorkspaceType = 'personal' | 'team';
export type WorkspaceRole = 'owner' | 'admin' | 'trainer' | 'annotator' | 'viewer';
export type StorageProvider = 'local' | 'cloud';
export type TrainingMode = 'beginner' | 'advanced' | 'expert';
export type ProjectStatus = 'draft' | 'dataset_ready' | 'training' | 'trained' | 'deployed';

export type V1TaskType = 'image_classification' | 'object_detection';
export type FutureTaskType =
  | 'image_segmentation'
  | 'anomaly_detection'
  | 'pose_estimation'
  | 'ocr_text'
  | 'video_recognition'
  | 'custom';

export type AnyTaskType = V1TaskType | FutureTaskType;

export type ProjectStageTab =
  | 'overview'
  | 'dataset'
  | 'annotation'
  | 'training'
  | 'evaluation'
  | 'model_hub'
  | 'app_builder'
  | 'deployment'
  | 'settings';

export type AppSection =
  | 'dashboard'
  | 'projects'
  | 'model_hub'
  | 'workspaces'
  | 'architecture'
  | 'settings';

export type ModelTierStatus =
  | 'fully_supported'
  | 'experimental'
  | 'inference_only'
  | 'external_gpu_required';

export type FineTuningStrategy = 'frozen_head' | 'partial_finetune' | 'full_finetune';
export type SchedulerType = 'none' | 'cosine' | 'step';
export type PreprocessMode = 'zero_one' | 'neg1_pos1';
export type FrameworkRuntime = 'tfjs' | 'pytorch' | 'ultralytics' | 'transformers' | 'onnx';
export type TargetDeviceType = 'browser' | 'mobile_pwa' | 'desktop_gpu' | 'edge_cpu';
export type OptimizationPriority = 'balanced' | 'accuracy' | 'speed' | 'small_size';

export interface ModelCatalogSpec {
  id: string;
  name: string;
  architecture: string;
  family: string;
  supportedTasks: AnyTaskType[];
  tierStatus: ModelTierStatus;
  backendEngine: TrainingBackendEngine;
  runtime: FrameworkRuntime;
  requiredPythonPackages: string[];
  pretrainedAvailable: boolean;
  pretrainedSourceLabel: string;
  checkpointUrl?: string;
  isGraphModel?: boolean;
  preprocessMode: PreprocessMode;
  recommendedInputSize: number;
  parameterCountLabel: string;
  parameterCountNum: number;
  modelSizeMb: number;
  minRamGb: number;
  gpuRequirement: string;
  cpuCompatible: boolean;
  browserCompatible: boolean;
  mobileCompatible: boolean;
  capabilities: {
    training: boolean;
    fineTuning: boolean;
    inference: boolean;
    multiLabel: boolean;
    zeroShot?: boolean;
  };
  supportedStrategies: FineTuningStrategy[];
  exportFormats: string[];
  license: string;
  commercialRestrictionNote: string;
  officialReferenceBenchmark: string;
  docsUrl: string;
  summaryEn: string;
  summaryAr: string;
}

export interface CachedCheckpointRecord {
  id: string;
  catalogModelId: string;
  checkpointUrl: string;
  isGraphModel: boolean;
  modelTopologyJson: string;
  weightSpecsJson: string;
  weightDataBase64: string;
  sha256: string;
  totalBytes: number;
  downloadedAt: string;
  verifiedAt: string;
}

export interface PythonWorkerCapabilities {
  reachable: boolean;
  torchInstalled: boolean;
  torchvisionInstalled: boolean;
  ultralyticsInstalled: boolean;
  timmInstalled: boolean;
  transformersInstalled: boolean;
  onnxInstalled: boolean;
  onnxruntimeInstalled: boolean;
  paddleocrInstalled: boolean;
  cudaAvailable: boolean;
  mpsAvailable: boolean;
  cpuCount: number;
  supportedArchitectures: string[];
}

export interface ModelRecommendation {
  spec: ModelCatalogSpec;
  rank: number;
  score: number;
  compatible: boolean;
  blockerReason?: string;
  reasonsEn: string[];
  reasonsAr: string[];
  estimatedRamGb: number;
  latencyTier: 'ultra_fast' | 'fast' | 'medium' | 'heavy';
  recommendedConfig: {
    fineTuningStrategy: FineTuningStrategy;
    learningRate: number;
    batchSize: number;
    epochs: number;
    inputSize: number;
    scheduler: SchedulerType;
    weightDecay: number;
  };
}

export interface ModelComparisonRow {
  modelId: string;
  modelName: string;
  architecture: string;
  backendEngine: TrainingBackendEngine;
  datasetId: string;
  datasetVersion: number;
  split: EvaluationSplitTarget;
  isMatchingSplit: boolean;
  primaryMetricName: 'accuracy' | 'mAP50';
  primaryMetricValue: number;
  f1Score: number;
  precision: number;
  recall: number;
  avgLatencyMs: number;
  weightSizeBytes: number;
  parameterCount: number;
  upstreamReferenceBenchmark: string;
  preprocessMode: PreprocessMode;
  fineTuningStrategy?: FineTuningStrategy;
}

export interface TrainingOptionsExtended {
  fineTuningStrategy?: FineTuningStrategy;
  scheduler?: SchedulerType;
  weightDecay?: number;
  multiLabel?: boolean;
  preprocessMode?: PreprocessMode;
  cloudCostApproved?: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  preferredLocale: Locale;
  preferredTheme: ThemeMode;
  planTier: PlanTier;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  cloudCreditsBalance: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Workspace {
  id: string;
  name: string;
  type: WorkspaceType;
  ownerUid: string;
  storageProvider: StorageProvider;
  cloudRegion: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Project {
  id: string;
  workspaceId: string;
  ownerUid: string;
  name: string;
  description: string;
  taskType: V1TaskType;
  engineVersion: 'v1.0';
  status: ProjectStatus;
  trainingMode: TrainingMode;
  storageLocation: StorageProvider;
  cloudConsentGranted: boolean;
  datasetCount: number;
  modelCount: number;
  appCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type DatasetSplit = 'train' | 'val' | 'test';
export type DatasetSourceType =
  | 'upload'
  | 'camera'
  | 'video_frame'
  | 'import_yolo'
  | 'import_coco';

export interface BoundingBox {
  id: string;
  className: string;
  /** Normalized top-left x in [0, 1] */
  x: number;
  /** Normalized top-left y in [0, 1] */
  y: number;
  /** Normalized width in (0, 1] */
  width: number;
  /** Normalized height in (0, 1] */
  height: number;
}

export interface AugmentationConfig {
  rotateDeg: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  brightnessDelta: number;
  contrastDelta: number;
  noiseLevel: number;
  blurRadius: number;
  resizeWidth: number;
  resizeHeight: number;
  applyOnlyToTrain: true;
}

export interface Dataset {
  id: string;
  projectId: string;
  ownerUid: string;
  name: string;
  description: string;
  version: number;
  classes: string[];
  splitTrainPct: number;
  splitValPct: number;
  splitTestPct: number;
  augmentationConfig: AugmentationConfig;
  imageCount: number;
  annotatedCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DatasetItem {
  id: string;
  datasetId: string;
  projectId: string;
  ownerUid: string;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  sourceType: DatasetSourceType;
  split: DatasetSplit;
  classificationLabel: string;
  annotations: BoundingBox[];
  blurScore: number;
  isApproved: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DatasetQualityReport {
  totalImages: number;
  annotatedImages: number;
  approvedImages: number;
  totalSizeBytes: number;
  splitCounts: Record<DatasetSplit, number>;
  classCounts: Record<string, number>;
  imbalanceRatio: number | null;
  duplicateGroups: { sha256: string; itemIds: string[]; filenames: string[] }[];
  missingAnnotationIds: string[];
  invalidAnnotationIds: string[];
  lowResolutionIds: string[];
  blurryImageIds: string[];
}

export type ActivityAction =
  | 'project_created'
  | 'project_updated'
  | 'project_deleted'
  | 'workspace_created'
  | 'settings_updated'
  | 'dataset_created'
  | 'dataset_updated'
  | 'dataset_exported'
  | 'training_started'
  | 'training_completed'
  | 'training_cancelled'
  | 'model_evaluated'
  | 'model_exported'
  | 'model_activated'
  | 'model_deleted'
  | 'app_created'
  | 'app_updated'
  | 'app_exported'
  | 'app_deleted';

export interface ActivityLog {
  id: string;
  ownerUid: string;
  projectId: string;
  action: ActivityAction;
  targetType: 'project' | 'workspace' | 'account' | 'dataset' | 'training_run' | 'model' | 'app';
  targetName: string;
  createdAt?: unknown;
}

export type TrainingBackendEngine = 'tfjs_browser' | 'python_fastapi';
export type TrainingStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';
export type OptimizerType = 'adam' | 'sgd' | 'rmsprop';

export interface TrainingHyperparameters {
  epochs: number;
  batchSize: number;
  learningRate: number;
  optimizer: OptimizerType;
  inputSize: number;
  confidenceThreshold: number;
  iouThreshold: number;
  earlyStoppingPatience: number;
  saveCheckpoints: boolean;
}

export interface EpochMetricPoint {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  trainMetric: number;
  valMetric: number;
  durationMs: number;
}

export interface TrainingDiagnostics {
  trainableParamCount: number;
  initialGradientNorm: number;
  epoch1ParamDelta: number;
  hasNonZeroGradients: boolean;
  allLossesFinite: boolean;
  parametersUpdated: boolean;
}

export interface SanityTestResult {
  passed: boolean;
  taskType: V1TaskType;
  architecture: string;
  sampleCount: number;
  stepsExecuted: number;
  initialLoss: number;
  finalLoss: number;
  lossReductionPct: number;
  paramDelta: number;
  hasNonZeroGradients: boolean;
  subsetAccuracy: number;
  details: string[];
}

export interface TrainingRun {
  id: string;
  projectId: string;
  datasetId: string;
  datasetVersion: number;
  ownerUid: string;
  taskType: V1TaskType;
  backendEngine: TrainingBackendEngine;
  architecture: string;
  trainingMode: TrainingMode;
  hyperparameters: TrainingHyperparameters;
  status: TrainingStatus;
  currentEpoch: number;
  totalEpochs: number;
  epochMetrics: EpochMetricPoint[];
  bestEpoch: number;
  bestValMetric: number;
  checkpointSaved: boolean;
  hardwareSummary: string;
  errorMessage: string;
  completedAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PerClassMetric {
  className: string;
  precision: number;
  recall: number;
  f1Score: number;
  support: number;
}

export interface TrainedModel {
  id: string;
  runId: string;
  projectId: string;
  datasetId: string;
  datasetVersion: number;
  ownerUid: string;
  name: string;
  taskType: V1TaskType;
  backendEngine: TrainingBackendEngine;
  architecture: string;
  license: string;
  classes: string[];
  inputSize: number;
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
  onDeviceCompatible: boolean;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ModelArchitectureSpec {
  id: string;
  name: string;
  taskType: V1TaskType;
  backendEngine: TrainingBackendEngine;
  license: string;
  recommendedInputSize: number;
  onDeviceCompatible: boolean;
  summaryEn: string;
  summaryAr: string;
}

export interface InferencePrediction {
  taskType: V1TaskType;
  latencyMs: number;
  classifications: { className: string; confidence: number }[];
  detections: {
    className: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

export type EvaluationSplitTarget = 'test' | 'val' | 'all';

export interface BatchEvalSampleResult {
  itemId: string;
  filename: string;
  split: DatasetSplit;
  groundTruthLabel: string;
  predictedLabel: string;
  confidence: number;
  correct: boolean;
  latencyMs: number;
  groundTruthBoxes: BoundingBox[];
  predictedBoxes: {
    className: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

export interface BatchEvaluationResult {
  modelId: string;
  split: EvaluationSplitTarget;
  sampleCount: number;
  skippedMissingBlobCount: number;
  confidenceThreshold: number;
  iouThreshold: number;
  accuracy: number;
  errorRate?: number;
  precision: number;
  recall: number;
  f1Score: number;
  mAP50: number;
  mAP50_95?: number;
  meanIoU?: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
  samples: BatchEvalSampleResult[];
}

export interface EvaluationReport {
  id: string;
  projectId: string;
  modelId: string;
  modelName: string;
  datasetId: string;
  datasetVersion: number;
  ownerUid: string;
  taskType: V1TaskType;
  split: EvaluationSplitTarget;
  sampleCount: number;
  confidenceThreshold: number;
  iouThreshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  mAP50: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
  createdAt?: unknown;
}

export type AppTier = 'basic' | 'custom' | 'professional';
export type AppRuntimeTarget = 'on_device_pwa' | 'hybrid_cloud';
export type AppInputSource = 'camera' | 'upload' | 'video';
export type GeneratedAppStatus = 'draft' | 'ready' | 'published';

export interface GeneratedApp {
  id: string;
  projectId: string;
  modelId: string;
  modelName: string;
  ownerUid: string;
  taskType: V1TaskType;
  name: string;
  shortName: string;
  description: string;
  tier: AppTier;
  themeColor: string;
  backgroundColor: ThemeMode;
  runtimeTarget: AppRuntimeTarget;
  inputSources: AppInputSource[];
  confidenceThreshold: number;
  iouThreshold: number;
  showConfidence: boolean;
  showLatency: boolean;
  showHistory: boolean;
  allowCsvExport: boolean;
  customHeaderTitle: string;
  customIconDataUrl?: string;
  alertEnabled: boolean;
  alertTargetClass: string;
  alertMinConfidence: number;
  status: GeneratedAppStatus;
  version: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BackendHealthResponse {
  status: string;
  service: string;
  phase: string;
  timestamp: string;
  uptimeSeconds: number;
  staticHosting?: boolean;
  adapters: {
    storage: {
      provider: string;
      region: string;
      configured: boolean;
      supportsPrivateLocalFirst: boolean;
      description: string;
      validationErrors?: string[];
    };
    compute: {
      provider: string;
      aiEngineConfigured: boolean;
      supportsCpuWorkers: boolean;
      supportsGpuWorkers: boolean;
    };
  };
}

export interface AiEnginePingResponse {
  reachable: boolean;
  status: 'online' | 'offline' | 'not_configured' | 'error';
  message: string;
  uptimeSeconds?: number | null;
  hardware: {
    cpu_count: number;
    architecture: string;
    os_name: string;
    torch_installed: boolean;
    torch_version: string | null;
    torchvision_installed?: boolean;
    ultralytics_installed?: boolean;
    cuda_available: boolean;
    cuda_device_count: number;
    cuda_devices: string[];
    mps_available: boolean;
  } | null;
}

