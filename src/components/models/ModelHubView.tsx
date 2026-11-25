import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Cpu,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  HardDrive,
  ImagePlus,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Trash2,
  Edit3,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { fetchAiEngineCapabilities } from '../../lib/apiClient';
import {
  exportPortableMkModelBundle,
  exportStoredModelArtifacts,
  generateIntegrationSnippets,
  generateModelCardReport,
  listStoredModelKeys,
  verifyExportedBundleReload,
} from '../../lib/localModelStore';
import {
  buildSameDatasetComparisonRows,
  checkWorkerCompatibility,
  MODEL_CATALOG,
} from '../../lib/modelRegistry';
import {
  deleteCachedCheckpoint,
  downloadAndCachePretrainedCheckpoint,
  listCachedCheckpoints,
  loadCachedCheckpointGraphModel,
  verifyCachedCheckpointIntegrity,
} from '../../lib/pretrainedWeightManager';
import { runCocoPretrainedInference } from '../../lib/tfTrainer';
import {
  deleteTrainedModel,
  logActivity,
  renameTrainedModel,
  setActiveTrainedModel,
} from '../../services/firestoreService';
import type {
  AnyTaskType,
  CachedCheckpointRecord,
  Dataset,
  EvaluationReport,
  InferencePrediction,
  ModelCatalogSpec,
  ModelTierStatus,
  Project,
  PythonWorkerCapabilities,
  TrainedModel,
} from '../../types/domain';

interface ModelHubViewProps {
  project?: Project;
  datasets?: Dataset[];
  activeDataset?: Dataset | null;
  trainedModels?: TrainedModel[];
  evaluationReports?: EvaluationReport[];
  onOpenTraining?: (archId?: string) => void;
  onOpenAppBuilder?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function triggerDownload(content: Blob | string, filename: string, mimeType: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const ALL_TASK_FILTERS: AnyTaskType[] = [
  'image_classification',
  'object_detection',
  'image_segmentation',
  'anomaly_detection',
  'pose_estimation',
  'ocr_text',
  'video_recognition',
];

export function ModelHubView({
  project,
  datasets = [],
  activeDataset = null,
  trainedModels = [],
  evaluationReports = [],
  onOpenTraining,
  onOpenAppBuilder,
}: ModelHubViewProps) {
  const { t, locale } = useI18n();
  const mh = t.modelHub;
  const ts = t.trainingStudio;

  const isProjectContext = Boolean(project);
  const [hubTab, setHubTab] = useState<'catalog' | 'trained'>(
    isProjectContext && trainedModels.length > 0 ? 'trained' : 'catalog'
  );

  useEffect(() => {
    if (!isProjectContext) {
      setHubTab('catalog');
    }
  }, [isProjectContext]);

  // =========================================================================
  // TAB 1: FOUNDATION CATALOG, PRETRAINED CHECKPOINTS & COCO TESTER STATE
  // =========================================================================
  const [catalogSearch, setCatalogSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState<AnyTaskType | 'all'>(
    project ? project.taskType : 'all'
  );
  const [tierFilter, setTierFilter] = useState<ModelTierStatus | 'all'>('all');
  const [expandedCatalogId, setExpandedCatalogId] = useState<string | null>(null);

  const [workerCaps, setWorkerCaps] = useState<PythonWorkerCapabilities | null>(null);
  const [probingWorker, setProbingWorker] = useState(false);

  const [cachedCheckpoints, setCachedCheckpoints] = useState<Map<string, CachedCheckpointRecord>>(
    new Map()
  );
  const [checkpointBusyId, setCheckpointBusyId] = useState<string | null>(null);
  const [checkpointNotice, setCheckpointNotice] = useState<string | null>(null);
  const [checkpointErr, setCheckpointErr] = useState<string | null>(null);

  // COCO Inference-Only Tester
  const cocoFileRef = useRef<HTMLInputElement | null>(null);
  const [cocoPreviewUrl, setCocoPreviewUrl] = useState<string | null>(null);
  const [cocoPred, setCocoPred] = useState<InferencePrediction | null>(null);
  const [cocoBusy, setCocoBusy] = useState(false);
  const [cocoErr, setCocoErr] = useState<string | null>(null);

  const refreshCachedCheckpoints = async () => {
    try {
      const list = await listCachedCheckpoints();
      const map = new Map<string, CachedCheckpointRecord>();
      for (const rec of list) {
        map.set(rec.catalogModelId, rec);
      }
      setCachedCheckpoints(map);
    } catch {
      // Ignore IndexedDB unavailability in SSR/tests
    }
  };

  const refreshWorkerCapabilities = async () => {
    setProbingWorker(true);
    try {
      const caps = await fetchAiEngineCapabilities();
      setWorkerCaps(caps);
    } finally {
      setProbingWorker(false);
    }
  };

  useEffect(() => {
    void refreshCachedCheckpoints();
    void refreshWorkerCapabilities();
  }, []);

  useEffect(() => {
    return () => {
      if (cocoPreviewUrl) URL.revokeObjectURL(cocoPreviewUrl);
    };
  }, [cocoPreviewUrl]);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return MODEL_CATALOG.filter((m) => {
      if (taskFilter !== 'all' && !m.supportedTasks.includes(taskFilter)) return false;
      if (tierFilter !== 'all' && m.tierStatus !== tierFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        m.architecture.toLowerCase().includes(q) ||
        m.license.toLowerCase().includes(q)
      );
    });
  }, [catalogSearch, taskFilter, tierFilter]);

  const downloadableModels = useMemo(
    () => MODEL_CATALOG.filter((m) => Boolean(m.checkpointUrl)),
    []
  );

  const handleDownloadCheckpoint = async (spec: ModelCatalogSpec) => {
    if (!spec.checkpointUrl) return;
    setCheckpointErr(null);
    setCheckpointNotice(null);
    setCheckpointBusyId(spec.id);
    try {
      const rec = await downloadAndCachePretrainedCheckpoint({
        catalogModelId: spec.id,
        checkpointUrl: spec.checkpointUrl,
        isGraphModel: Boolean(spec.isGraphModel),
        onProgress: (msg) => setCheckpointNotice(msg),
      });
      await refreshCachedCheckpoints();
      setCheckpointNotice(
        `${spec.name} cached & verified (SHA-256: ${rec.sha256.slice(0, 16)}...)`
      );
    } catch (err) {
      setCheckpointErr(err instanceof Error ? err.message : 'Failed to download checkpoint.');
    } finally {
      setCheckpointBusyId(null);
    }
  };

  const handleVerifyCheckpoint = async (spec: ModelCatalogSpec) => {
    const rec = cachedCheckpoints.get(spec.id);
    if (!rec) return;
    setCheckpointErr(null);
    setCheckpointNotice(null);
    const check = await verifyCachedCheckpointIntegrity(rec);
    if (check.valid) {
      setCheckpointNotice(
        `${spec.name} SHA-256 verified (${check.computedSha256.slice(0, 16)}...).`
      );
    } else {
      setCheckpointErr(
        `${spec.name} integrity check failed. Re-downloading recommended.`
      );
    }
  };

  const handleDeleteCheckpoint = async (catalogId: string) => {
    await deleteCachedCheckpoint(catalogId);
    await refreshCachedCheckpoints();
    setCheckpointNotice(null);
  };

  const handleCocoTestFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const cocoSpec = MODEL_CATALOG.find((m) => m.id === 'ssdlite_mobilenet_v2_coco');
    if (!cocoSpec || !cocoSpec.checkpointUrl) return;

    if (cocoPreviewUrl) URL.revokeObjectURL(cocoPreviewUrl);
    setCocoPreviewUrl(URL.createObjectURL(file));
    setCocoPred(null);
    setCocoErr(null);
    setCocoBusy(true);

    try {
      const ckpt = await downloadAndCachePretrainedCheckpoint({
        catalogModelId: cocoSpec.id,
        checkpointUrl: cocoSpec.checkpointUrl,
        isGraphModel: true,
        onProgress: (msg) => setCheckpointNotice(msg),
      });
      await refreshCachedCheckpoints();
      const graphModel = await loadCachedCheckpointGraphModel(ckpt);
      try {
        const pred = await runCocoPretrainedInference({
          graphModel,
          imageBlob: file,
          confidenceThreshold: 0.3,
          iouThreshold: 0.45,
        });
        setCocoPred(pred);
      } finally {
        graphModel.dispose();
      }
    } catch (err) {
      setCocoErr(err instanceof Error ? err.message : 'COCO inference failed.');
    } finally {
      setCocoBusy(false);
    }
  };

  const tierLabel = (tier: ModelTierStatus) => {
    switch (tier) {
      case 'fully_supported':
        return mh.tierFullySupported;
      case 'experimental':
        return mh.tierExperimental;
      case 'inference_only':
        return mh.tierInferenceOnly;
      default:
        return mh.tierExternalGpu;
    }
  };

  const tierBadgeClass = (tier: ModelTierStatus) => {
    switch (tier) {
      case 'fully_supported':
        return 'border-emerald-300 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400';
      case 'inference_only':
        return 'border-sky-300 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400';
      case 'experimental':
        return 'border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400';
      default:
        return 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300';
    }
  };

  // =========================================================================
  // TAB 2: PROJECT TRAINED MODELS REGISTRY & SAME-SPLIT BENCHMARK
  // =========================================================================
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'on_device'>('all');
  const [localWeightKeys, setLocalWeightKeys] = useState<Set<string>>(new Set());
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [verifyBundleMsg, setVerifyBundleMsg] = useState<string | null>(null);

  useEffect(() => {
    listStoredModelKeys()
      .then((keys) => setLocalWeightKeys(keys))
      .catch(() => {});
  }, [trainedModels.length]);

  useEffect(() => {
    if (trainedModels.length === 0) {
      setSelectedModelId('');
      return;
    }
    if (!selectedModelId || !trainedModels.some((m) => m.id === selectedModelId)) {
      const active = trainedModels.find((m) => m.isActive) || trainedModels[0];
      setSelectedModelId(active.id);
    }
  }, [trainedModels]);

  const versionMap = useMemo(() => {
    const map = new Map<string, number>();
    const chronological = [...trainedModels].reverse();
    chronological.forEach((m, idx) => {
      map.set(m.id, idx + 1);
    });
    return map;
  }, [trainedModels]);

  const filteredModels = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return trainedModels.filter((m) => {
      if (filterMode === 'active' && !m.isActive) return false;
      if (filterMode === 'on_device' && !m.onDeviceCompatible) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.architecture.toLowerCase().includes(q) ||
        m.classes.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [trainedModels, searchTerm, filterMode]);

  const selectedModel = useMemo(
    () => trainedModels.find((m) => m.id === selectedModelId) || filteredModels[0] || null,
    [trainedModels, filteredModels, selectedModelId]
  );

  const selectedLatestReport = useMemo(() => {
    if (!selectedModel) return null;
    return evaluationReports.find((r) => r.modelId === selectedModel.id) || null;
  }, [selectedModel, evaluationReports]);

  const benchmarkDataset = activeDataset || datasets[0] || null;
  const comparisonRows = useMemo(() => {
    if (!project || !benchmarkDataset || trainedModels.length === 0) return [];
    return buildSameDatasetComparisonRows(
      trainedModels,
      evaluationReports,
      project.id,
      benchmarkDataset.id,
      benchmarkDataset.version,
      'test'
    );
  }, [project, benchmarkDataset, trainedModels, evaluationReports]);

  const handleRenameSubmit = async (modelId: string) => {
    setActionError(null);
    try {
      await renameTrainedModel({ modelId, newName: renameDraft });
      setRenamingId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Rename failed.');
    }
  };

  const handleExportTfjs = async (model: TrainedModel) => {
    if (!project) return;
    setActionError(null);
    const exported = await exportStoredModelArtifacts(model.id);
    if (!exported) {
      setActionError(t.evaluationStudio.noLocalWeightsError);
      return;
    }
    triggerDownload(exported.manifestJson, `${exported.filenameBase}.model.json`, 'application/json');
    triggerDownload(exported.weightsBlob, `${model.id}.weights.bin`, 'application/octet-stream');
    await logActivity({
      ownerUid: project.ownerUid,
      projectId: project.id,
      action: 'model_exported',
      targetType: 'model',
      targetName: model.name,
    });
  };

  const handleExportPortableBundle = async (model: TrainedModel) => {
    if (!project) return;
    setActionError(null);
    setVerifyBundleMsg(null);
    const res = await exportPortableMkModelBundle(model);
    if (!res) {
      setActionError(t.evaluationStudio.noLocalWeightsError);
      return;
    }
    triggerDownload(res.bundleJson, res.filename, 'application/json');
    await logActivity({
      ownerUid: project.ownerUid,
      projectId: project.id,
      action: 'model_exported',
      targetType: 'model',
      targetName: model.name,
    });
  };

  const handleVerifyPortableReload = async (model: TrainedModel) => {
    setActionError(null);
    setVerifyBundleMsg(null);
    const res = await exportPortableMkModelBundle(model);
    if (!res) {
      setActionError(t.evaluationStudio.noLocalWeightsError);
      return;
    }
    try {
      const verified = await verifyExportedBundleReload(res.bundleJson);
      setVerifyBundleMsg(
        verified.valid
          ? `Reload OK · Output [${verified.outputShape.join('×')}] · Finite predictions verified`
          : 'Bundle verification produced invalid/non-finite outputs.'
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Bundle verification failed.');
    }
  };

  const handleExportCard = async (model: TrainedModel, format: 'json' | 'csv') => {
    const rep = evaluationReports.find((r) => r.modelId === model.id) || null;
    const card = generateModelCardReport(model, rep);
    if (format === 'json') {
      triggerDownload(card.json, `${model.architecture}_${model.id}.eval.json`, 'application/json');
    } else {
      triggerDownload(card.csv, `${model.architecture}_${model.id}.metrics.csv`, 'text/csv');
    }
  };

  const handleExportSnippet = (model: TrainedModel, lang: 'ts' | 'py') => {
    const snippets = generateIntegrationSnippets(model);
    if (lang === 'ts') {
      triggerDownload(snippets.browserTs, `${model.architecture}_inference.ts`, 'text/typescript');
    } else {
      triggerDownload(snippets.pythonPy, `${model.architecture}_inference.py`, 'text/x-python');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Top Mode Switcher */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {mh.heading}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{mh.subheading}</p>
          </div>
          {isProjectContext && onOpenAppBuilder && trainedModels.length > 0 && (
            <button
              type="button"
              onClick={onOpenAppBuilder}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Rocket className="w-3.5 h-3.5" />
              <span>{mh.continueAppBuilderBtn}</span>
            </button>
          )}
        </div>

        {isProjectContext && (
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setHubTab('catalog')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                hubTab === 'catalog'
                  ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {mh.catalogTab} ({MODEL_CATALOG.length})
            </button>
            <button
              type="button"
              onClick={() => setHubTab('trained')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                hubTab === 'trained'
                  ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                  : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {mh.trainedTab} ({trainedModels.length})
            </button>
          </div>
        )}
      </div>

      {/* =================================================================== */}
      {/* TAB 1: FOUNDATION CATALOG + PRETRAINED CACHE + COCO LIVE TESTER     */}
      {/* =================================================================== */}
      {hubTab === 'catalog' && (
        <div className="space-y-6">
          {/* Worker Capability Probe Banner + Catalog Filters */}
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800 text-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                  <Cpu className="w-4 h-4 text-red-600" />
                  <span>{mh.catalogTitle}</span>
                </div>
                <p className="text-zinc-500 dark:text-zinc-400">
                  {workerCaps?.reachable
                    ? `Python AI Worker Online · CPU ${workerCaps.cpuCount} · CUDA: ${
                        workerCaps.cudaAvailable ? 'Yes' : 'No'
                      } · Packages: ${
                        [
                          workerCaps.torchInstalled && 'torch',
                          workerCaps.timmInstalled && 'timm',
                          workerCaps.ultralyticsInstalled && 'ultralytics',
                          workerCaps.transformersInstalled && 'transformers',
                          workerCaps.onnxruntimeInstalled && 'onnxruntime',
                        ]
                          .filter(Boolean)
                          .join(', ') || 'none'
                      }`
                    : 'In-Browser TensorFlow.js runtime ready · External Python GPU Worker currently offline/unconfigured.'}
                </p>
              </div>
              <button
                type="button"
                disabled={probingWorker}
                onClick={() => void refreshWorkerCapabilities()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${probingWorker ? 'animate-spin' : ''}`} />
                <span>{t.projectWorkspace.engineProbeBtn}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute start-3 top-2.5" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder={mh.searchPlaceholder}
                  className="w-full ps-9 pe-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                />
              </div>

              <select
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value as AnyTaskType | 'all')}
                className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="all">{mh.allTasksFilter}</option>
                {ALL_TASK_FILTERS.map((task) => (
                  <option key={task} value={task}>
                    {t.tasks[task]}
                  </option>
                ))}
              </select>

              <select
                value={tierFilter}
                onChange={(e) => setTierFilter(e.target.value as ModelTierStatus | 'all')}
                className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              >
                <option value="all">{mh.filterAll}</option>
                <option value="fully_supported">{mh.tierFullySupported}</option>
                <option value="experimental">{mh.tierExperimental}</option>
                <option value="inference_only">{mh.tierInferenceOnly}</option>
                <option value="external_gpu_required">{mh.tierExternalGpu}</option>
              </select>
            </div>
          </div>

          {/* Catalog Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredCatalog.map((spec) => {
              const cached = cachedCheckpoints.get(spec.id);
              const workerCheck = checkWorkerCompatibility(spec, workerCaps);
              const expanded = expandedCatalogId === spec.id;
              const matchesProjectTask =
                !project || spec.supportedTasks.includes(project.taskType);
              const canTrainInProject =
                Boolean(project) &&
                Boolean(onOpenTraining) &&
                matchesProjectTask &&
                spec.capabilities.training &&
                (spec.backendEngine === 'tfjs_browser' || workerCheck.compatible);

              return (
                <div
                  key={spec.id}
                  className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span
                          className={`px-2 py-0.5 font-semibold border rounded ${tierBadgeClass(
                            spec.tierStatus
                          )}`}
                        >
                          {tierLabel(spec.tierStatus)}
                        </span>
                        <span className="font-mono text-zinc-500">
                          {spec.family} · {spec.runtime.toUpperCase()}
                        </span>
                      </div>
                      <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
                        {spec.name}
                      </h3>
                    </div>

                    <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                      {spec.license}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {locale === 'ar' ? spec.summaryAr : spec.summaryEn}
                  </p>

                  {/* Core Specs Strip */}
                  <div className="grid grid-cols-4 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] tabular-nums">
                    <div>
                      <span className="text-zinc-500 block">{ts.paramsLabel}</span>
                      <span className="font-mono font-semibold">{spec.parameterCountLabel}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Size</span>
                      <span className="font-mono font-semibold">{spec.modelSizeMb} MB</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Min RAM</span>
                      <span className="font-mono font-semibold">{spec.minRamGb} GB</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Input</span>
                      <span className="font-mono font-semibold">{spec.recommendedInputSize}px</span>
                    </div>
                  </div>

                  {/* Honest Capability & Runtime Row */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={
                        spec.capabilities.training
                          ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                          : 'text-sky-700 dark:text-sky-400 font-medium'
                      }
                    >
                      {spec.capabilities.training ? 'Train & Fine-Tune' : 'Inference-Only'}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {spec.browserCompatible ? 'Browser/PWA' : 'Server Python'}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {spec.pretrainedAvailable ? spec.pretrainedSourceLabel : 'Train from Scratch'}
                    </span>
                  </div>

                  {!workerCheck.compatible && spec.backendEngine === 'python_fastapi' && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      {workerCheck.reason}
                    </p>
                  )}

                  {cached && (
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {mh.cachedStatus} · {formatBytes(cached.totalBytes)} · SHA{' '}
                        {cached.sha256.slice(0, 12)}
                      </span>
                    </div>
                  )}

                  {/* Expandable Metadata & License Details */}
                  {expanded && (
                    <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2 text-[11px]">
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                          GPU / Hardware:{' '}
                        </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {spec.gpuRequirement} (CPU: {spec.cpuCompatible ? 'Yes' : 'No'}, Mobile:{' '}
                          {spec.mobileCompatible ? 'Yes' : 'No'})
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                          {mh.officialReferenceBadge}:{' '}
                        </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {spec.officialReferenceBenchmark}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                          License Note:{' '}
                        </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {spec.commercialRestrictionNote}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                          Exports:{' '}
                        </span>
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {spec.exportFormats.join(' · ')}
                        </span>
                      </div>
                      <a
                        href={spec.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-red-600 hover:underline pt-1"
                      >
                        <span>Documentation & Source</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setExpandedCatalogId(expanded ? null : spec.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      {expanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      <span>Specs & License</span>
                    </button>

                    <div className="flex items-center gap-2">
                      {spec.checkpointUrl && !cached && (
                        <button
                          type="button"
                          disabled={checkpointBusyId === spec.id}
                          onClick={() => void handleDownloadCheckpoint(spec)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>
                            {checkpointBusyId === spec.id ? '...' : mh.downloadAndVerifyBtn}
                          </span>
                        </button>
                      )}

                      {isProjectContext && onOpenTraining && matchesProjectTask && (
                        <button
                          type="button"
                          disabled={!canTrainInProject}
                          onClick={() => onOpenTraining(spec.id)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          {spec.capabilities.training
                            ? mh.useInProjectBtn
                            : mh.tierInferenceOnly}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pretrained Offline Checkpoint Manager & COCO Inference-Only Tester */}
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-5">
            <div>
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                {mh.checkpointCacheTitle}
              </h3>
              {checkpointNotice && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                  {checkpointNotice}
                </p>
              )}
              {checkpointErr && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{checkpointErr}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {downloadableModels.map((spec) => {
                const cached = cachedCheckpoints.get(spec.id);
                const busy = checkpointBusyId === spec.id;
                return (
                  <div
                    key={spec.id}
                    className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {spec.name}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          ~{spec.modelSizeMb} MB
                        </span>
                      </div>
                      <p className="font-mono text-[11px] text-zinc-500 truncate" dir="ltr">
                        {cached
                          ? `${mh.cachedStatus} · SHA-256 ${cached.sha256.slice(0, 16)}...`
                          : 'Not cached in IndexedDB'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDownloadCheckpoint(spec)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900 font-medium"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{busy ? '...' : mh.downloadAndVerifyBtn}</span>
                      </button>
                      {cached && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleVerifyCheckpoint(spec)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900 font-medium"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{mh.verifyIntegrityBtn}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCheckpoint(spec.id)}
                            className="inline-flex items-center gap-1 text-red-600 hover:underline px-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live Browser COCO 80-Class Object Detector Tester (Inference-Only) */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
                    {mh.cocoTesterTitle}
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {mh.cocoTesterDesc}
                  </p>
                </div>
                <input
                  ref={cocoFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleCocoTestFile}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={cocoBusy}
                  onClick={() => cocoFileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 whitespace-nowrap shrink-0"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{cocoBusy ? t.common.loading : mh.uploadCocoTestBtn}</span>
                </button>
              </div>

              {cocoErr && <p className="text-xs text-red-600 dark:text-red-400">{cocoErr}</p>}

              {cocoPreviewUrl && cocoPred && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 flex justify-center">
                    <div className="relative inline-block">
                      <img
                        src={cocoPreviewUrl}
                        alt="COCO inference input"
                        className="max-h-72 object-contain"
                      />
                      {cocoPred.detections.map((d, idx) => (
                        <div
                          key={idx}
                          style={{
                            left: `${d.x * 100}%`,
                            top: `${d.y * 100}%`,
                            width: `${d.width * 100}%`,
                            height: `${d.height * 100}%`,
                          }}
                          className="absolute border-2 border-red-600 pointer-events-none"
                        >
                          <span className="bg-red-600 text-white text-[10px] px-1 font-mono">
                            {d.className} {Math.round(d.confidence * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2 text-xs">
                    <p className="font-mono text-zinc-500 tabular-nums">
                      {ts.latencyLabel}: {cocoPred.latencyMs} ms · Detections:{' '}
                      {cocoPred.detections.length}
                    </p>
                    {cocoPred.detections.length === 0 ? (
                      <p className="text-zinc-500">0 COCO objects detected above 30% confidence.</p>
                    ) : (
                      cocoPred.detections.map((d, i) => (
                        <div
                          key={i}
                          className="flex justify-between p-2 rounded border border-zinc-200 dark:border-zinc-800 tabular-nums"
                        >
                          <span className="font-medium">{d.className}</span>
                          <span className="font-mono">{Math.round(d.confidence * 100)}%</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: PROJECT TRAINED MODELS REGISTRY & SAME-SPLIT BENCHMARK       */}
      {/* =================================================================== */}
      {isProjectContext && hubTab === 'trained' && project && (
        <div className="space-y-6">
          {trainedModels.length === 0 ? (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 bg-white dark:bg-zinc-900 text-center space-y-4">
              <Box className="w-8 h-8 text-red-600 mx-auto" />
              <div className="space-y-1.5 max-w-md mx-auto">
                <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
                  {mh.emptyTitle}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{mh.emptyDesc}</p>
              </div>
              {onOpenTraining && (
                <button
                  type="button"
                  onClick={() => onOpenTraining()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  <Cpu className="w-4 h-4" />
                  <span>{t.evaluationStudio.goToTrainingBtn}</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Search/Filter Bar */}
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-zinc-400 absolute start-3 top-2.5" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={mh.searchPlaceholder}
                    className="w-full ps-9 pe-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  {(['all', 'active', 'on_device'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilterMode(f)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        filterMode === f
                          ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {f === 'all'
                        ? mh.filterAll
                        : f === 'active'
                        ? mh.filterActive
                        : mh.filterOnDevice}
                    </button>
                  ))}
                </div>
              </div>

              {actionError && <p className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
              {verifyBundleMsg && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">{verifyBundleMsg}</p>
              )}

              {/* Registry Cards + Selected Model Inspector */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  {filteredModels.map((model) => {
                    const versionNum = versionMap.get(model.id) ?? 1;
                    const weightsLocal = localWeightKeys.has(model.id);
                    const isSelected = selectedModel?.id === model.id;
                    const primaryScore =
                      model.taskType === 'object_detection' ? model.mAP50 : model.accuracy;

                    return (
                      <div
                        key={model.id}
                        onClick={() => setSelectedModelId(model.id)}
                        className={`border rounded-xl p-5 bg-white dark:bg-zinc-900 cursor-pointer transition-colors space-y-4 ${
                          isSelected
                            ? 'border-red-600'
                            : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                              {mh.versionPrefix} v{versionNum} · {model.architecture} · Dataset v
                              {model.datasetVersion} · {model.license}
                            </div>

                            {renamingId === model.id ? (
                              <div
                                className="flex items-center gap-2 pt-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  value={renameDraft}
                                  onChange={(e) => setRenameDraft(e.target.value)}
                                  className="px-2.5 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleRenameSubmit(model.id)}
                                  className="px-2.5 py-1 text-xs font-semibold rounded bg-red-600 text-white"
                                >
                                  {mh.saveNameBtn}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRenamingId(null)}
                                  className="px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700"
                                >
                                  {mh.cancelRenameBtn}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                  {model.name}
                                </h3>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenamingId(model.id);
                                    setRenameDraft(model.name);
                                  }}
                                  className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                                  title={mh.renameBtn}
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                            <p
                              className={`text-xs ${
                                weightsLocal
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {weightsLocal ? mh.weightsReady : mh.weightsMissing}
                            </p>
                          </div>

                          <div
                            className="flex items-center gap-2 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {model.isActive ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="w-4 h-4" />
                                <span>{mh.activeTargetLabel}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  void setActiveTrainedModel(trainedModels, model.id, {
                                    ownerUid: project.ownerUid,
                                    projectId: project.id,
                                    modelName: model.name,
                                  })
                                }
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                {mh.setActiveBtn}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 text-xs tabular-nums">
                          <div>
                            <p className="text-zinc-500">
                              {model.taskType === 'object_detection' ? ts.map50Label : ts.accuracyLabel}
                            </p>
                            <p className="font-mono font-semibold text-red-600 mt-0.5">
                              {Math.round(primaryScore * 100)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-500">{ts.f1Label}</p>
                            <p className="font-mono font-semibold mt-0.5">
                              {Math.round(model.f1Score * 100)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-500">{ts.latencyLabel}</p>
                            <p className="font-mono font-semibold mt-0.5">
                              {model.inferenceLatencyMs} ms
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-500">{ts.modelSizeLabel}</p>
                            <p className="font-mono font-semibold mt-0.5">
                              {formatBytes(model.weightSizeBytes)}
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-500">{ts.paramsLabel}</p>
                            <p className="font-mono font-semibold mt-0.5">
                              {model.parameterCount.toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right Column: Compatibility & Artifact Export Studio */}
                {selectedModel && (
                  <div className="space-y-4">
                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-4">
                      <div>
                        <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
                          {mh.compatibilityTitle}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">{selectedModel.name}</p>
                      </div>

                      <div className="space-y-2.5 text-xs">
                        {[
                          {
                            label: mh.desktopReady,
                            ok: selectedModel.onDeviceCompatible,
                          },
                          {
                            label: mh.mobileReady,
                            ok:
                              selectedModel.onDeviceCompatible &&
                              selectedModel.weightSizeBytes <= 25_000_000,
                          },
                          {
                            label: mh.tabletReady,
                            ok: selectedModel.onDeviceCompatible,
                          },
                          {
                            label: mh.offlineReady,
                            ok:
                              selectedModel.onDeviceCompatible &&
                              localWeightKeys.has(selectedModel.id),
                          },
                        ].map((row) => (
                          <div
                            key={row.label}
                            className="flex items-center justify-between py-1.5 border-b border-zinc-100 dark:border-zinc-800/60"
                          >
                            <span className="text-zinc-700 dark:text-zinc-300">{row.label}</span>
                            <span
                              className={`font-semibold ${
                                row.ok
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-zinc-500 dark:text-zinc-400'
                              }`}
                            >
                              {row.ok ? mh.compatibleYes : mh.compatibleNo}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3">
                      <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
                        {mh.exportPanelTitle}
                      </h3>

                      {selectedLatestReport && (
                        <p className="text-[11px] text-zinc-500 tabular-nums">
                          {selectedLatestReport.split.toUpperCase()} · {selectedLatestReport.sampleCount}{' '}
                          samples · {selectedLatestReport.avgLatencyMs} ms
                        </p>
                      )}

                      <div className="space-y-2">
                        <button
                          type="button"
                          disabled={!localWeightKeys.has(selectedModel.id)}
                          onClick={() => void handleExportTfjs(selectedModel)}
                          className="w-full inline-flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                        >
                          <span>{mh.exportTfjsBtn}</span>
                          <Download className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          disabled={!localWeightKeys.has(selectedModel.id)}
                          onClick={() => void handleExportPortableBundle(selectedModel)}
                          className="w-full inline-flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                        >
                          <span>{mh.exportBundleBtn}</span>
                          <FileJson className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          disabled={!localWeightKeys.has(selectedModel.id)}
                          onClick={() => void handleVerifyPortableReload(selectedModel)}
                          className="w-full inline-flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                        >
                          <span>{mh.verifyBundleBtn}</span>
                          <HardDrive className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleExportCard(selectedModel, 'json')}
                          className="w-full inline-flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <span>{mh.exportCardJsonBtn}</span>
                          <FileJson className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleExportCard(selectedModel, 'csv')}
                          className="w-full inline-flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <span>{mh.exportCardCsvBtn}</span>
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleExportSnippet(selectedModel, 'ts')}
                          className="w-full inline-flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <span>{mh.exportTsBtn}</span>
                          <Code2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleExportSnippet(selectedModel, 'py')}
                          className="w-full inline-flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <span>{mh.exportPyBtn}</span>
                          <Code2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
                        {confirmDeleteId !== selectedModel.id ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(selectedModel.id)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:underline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{mh.deleteModelBtn}</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const remaining = Math.max(0, trainedModels.length - 1);
                                void deleteTrainedModel(selectedModel.id, project.id, remaining, {
                                  ownerUid: project.ownerUid,
                                  modelName: selectedModel.name,
                                });
                                setConfirmDeleteId(null);
                              }}
                              className="px-3 py-1.5 text-xs font-semibold rounded bg-red-600 text-white"
                            >
                              {mh.confirmDeleteBtn}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-3 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700"
                            >
                              {mh.cancelRenameBtn}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Same-Dataset Cross-Model Benchmark Table */}
              {comparisonRows.length > 0 && benchmarkDataset && (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4 overflow-x-auto">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                        {mh.sameSplitBenchmarkTitle}
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {benchmarkDataset.name} (v{benchmarkDataset.version}) ·{' '}
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {mh.userDatasetMetricsBadge}
                        </span>
                      </p>
                    </div>
                  </div>

                  <table className="w-full text-xs border-collapse tabular-nums">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                        <th className="py-2 text-start font-medium">Model</th>
                        <th className="py-2 text-start font-medium">Norm</th>
                        <th className="py-2 text-end font-medium">{mh.userDatasetMetricsBadge}</th>
                        <th className="py-2 text-end font-medium">{ts.f1Label}</th>
                        <th className="py-2 text-end font-medium">{ts.latencyLabel}</th>
                        <th className="py-2 text-start ps-4 font-medium">
                          {mh.officialReferenceBadge}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr
                          key={row.modelId}
                          className="border-b border-zinc-100 dark:border-zinc-800/60"
                        >
                          <td className="py-2.5 font-medium">
                            <div className="text-zinc-900 dark:text-zinc-100">{row.modelName}</div>
                            {!row.isMatchingSplit && (
                              <div className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{mh.datasetMismatchWarning}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 font-mono text-[11px] text-zinc-500">
                            {row.preprocessMode}
                          </td>
                          <td className="py-2.5 text-end font-mono font-semibold text-red-600">
                            {Math.round(row.primaryMetricValue * 100)}% (v{row.datasetVersion} ·{' '}
                            {row.split})
                          </td>
                          <td className="py-2.5 text-end font-mono">
                            {Math.round(row.f1Score * 100)}%
                          </td>
                          <td className="py-2.5 text-end font-mono">{row.avgLatencyMs} ms</td>
                          <td className="py-2.5 ps-4 text-zinc-500 dark:text-zinc-400">
                            {row.upstreamReferenceBenchmark}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
