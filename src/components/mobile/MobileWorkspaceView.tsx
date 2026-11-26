import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FolderPlus,
  HardDrive,
  Laptop,
  Link2,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Moon,
  Trash2,
  Unlink,
  UploadCloud,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTheme } from '../../contexts/ThemeContext';
import {
  controlPythonTrainingJob,
  fetchPythonTrainingJob,
  pingAiEngine,
  startPythonTrainingJob,
} from '../../lib/apiClient';
import {
  auditDatasetQuality,
  validateDatasetForTraining,
} from '../../lib/datasetUtils';
import { listStoredDatasetBlobIds } from '../../lib/localMediaStore';
import {
  exportPortableMkModelBundle,
  generateModelCardReport,
  loadTfModelFromIndexedDb,
} from '../../lib/localModelStore';
import {
  type CachedModelSnapshot,
  type CachedProjectSnapshot,
  type MobileStorageQuotaSummary,
  type OfflineSyncQueueEntry,
  cacheModelSnapshots,
  flushOfflineSyncQueue,
  getMobileStorageQuota,
  listCachedModelSnapshots,
  listCachedProjectSnapshots,
  listOfflineSyncQueue,
  mergeCachedAndLiveProjects,
  removeOfflineSyncEntry,
} from '../../lib/mobileOfflineStore';
import {
  type PairedDesktopReachability,
  checkPairedDesktopReachability,
  clearStoredDesktopPairing,
  controlPairedDesktopTrainingJob,
  dispatchPairedDesktopTrainingJob,
  fetchPairedDesktopTrainingJob,
  getStoredDesktopPairing,
  pairWithDesktopCompanion,
} from '../../lib/mobilePairingClient';
import { getCatalogModelsForTask, getModelCatalogEntry } from '../../lib/modelRegistry';
import {
  getRecommendedHyperparameters,
  predictImageWithLocalModel,
  runBrowserTrainingPipeline,
} from '../../lib/tfTrainer';
import {
  createDataset,
  createTrainingRun,
  deleteDatasetItem,
  saveTrainedModelRecord,
  setActiveTrainedModel,
  subscribeDatasetItems,
  subscribeProjectDatasets,
  subscribeProjectTrainedModels,
  subscribeProjectTrainingRuns,
  syncDatasetCounters,
  updateTrainingRunProgress,
  updateTrainingRunStatus,
} from '../../services/firestoreService';
import type {
  Dataset,
  DatasetItem,
  EpochMetricPoint,
  InferencePrediction,
  Project,
  TrainedModel,
  TrainingRun,
  UserProfile,
} from '../../types/domain';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { MobileBboxAnnotator } from './MobileBboxAnnotator';
import { type MobileTabId } from './MobileBottomNav';
import { MobileCameraCapture } from './MobileCameraCapture';

interface MobileWorkspaceViewProps {
  activeTab: MobileTabId;
  onSelectTab: (tab: MobileTabId) => void;
  profile: UserProfile | null;
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  trainingRuns: TrainingRun[];
  isOnline: boolean;
  updateAvailable: boolean;
  checkingUpdate: boolean;
  onCheckForUpdates: () => Promise<boolean>;
  onApplyUpdate: () => Promise<void>;
  onCreateProject: () => void;
  onOpenNotifications: () => void;
  onSwitchToDesktopLayout: () => void;
}

type CaptureSubMode = 'camera' | 'annotate' | 'quality';
type MobileExecutionTarget = 'browser' | 'desktop' | 'cloud';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function downloadFileBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function shareOrDownloadText(filename: string, content: string, mime: string, title: string) {
  const file = new File([content], filename, { type: mime });
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ title, files: [file] });
      return 'shared';
    } catch {
      // Fallback to direct download if user cancelled share sheet or platform rejected file share
    }
  }
  downloadFileBlob(filename, content, mime);
  return 'downloaded';
}

export function MobileWorkspaceView({
  activeTab,
  onSelectTab,
  profile,
  projects,
  selectedProjectId,
  onSelectProject,
  trainingRuns,
  isOnline,
  updateAvailable,
  checkingUpdate,
  onCheckForUpdates,
  onApplyUpdate,
  onCreateProject,
  onOpenNotifications,
  onSwitchToDesktopLayout,
}: MobileWorkspaceViewProps) {
  const { user, signOut } = useAuth();
  const { locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { pushNotification, browserPermission, requestBrowserPermission, unreadCount } =
    useNotifications();

  // Offline snapshots & queue
  const [cachedProjects, setCachedProjects] = useState<CachedProjectSnapshot[]>([]);
  const [cachedModels, setCachedModels] = useState<CachedModelSnapshot[]>([]);
  const [syncQueue, setSyncQueue] = useState<OfflineSyncQueueEntry[]>([]);
  const [quota, setQuota] = useState<MobileStorageQuotaSummary | null>(null);
  const [syncingQueue, setSyncingQueue] = useState(false);

  const refreshOfflineState = async () => {
    const [cp, cm, q, sq] = await Promise.all([
      listCachedProjectSnapshots(),
      listCachedModelSnapshots(),
      listOfflineSyncQueue(),
      getMobileStorageQuota(),
    ]);
    setCachedProjects(cp);
    setCachedModels(cm);
    setSyncQueue(q);
    setQuota(sq);
  };

  useEffect(() => {
    void refreshOfflineState();
  }, [activeTab, isOnline, projects.length]);

  const mergedProjects = useMemo(
    () => mergeCachedAndLiveProjects(projects, cachedProjects, isOnline),
    [projects, cachedProjects, isOnline]
  );

  const activeProject = useMemo(() => {
    if (mergedProjects.length === 0) return null;
    if (selectedProjectId) {
      const found = mergedProjects.find((p) => p.project.id === selectedProjectId);
      if (found) return found.project;
    }
    return mergedProjects[0].project;
  }, [mergedProjects, selectedProjectId]);

  // Project-scoped Firestore subscriptions
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [items, setItems] = useState<DatasetItem[]>([]);
  const [projectRuns, setProjectRuns] = useState<TrainingRun[]>([]);
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([]);

  useEffect(() => {
    if (!user || !activeProject || !isOnline) {
      return;
    }
    const uDs = subscribeProjectDatasets(activeProject.id, user.uid, (list) => {
      setDatasets(list);
      if (list.length > 0 && (!selectedDatasetId || !list.some((d) => d.id === selectedDatasetId))) {
        setSelectedDatasetId(list[0].id);
      }
    });
    const uRuns = subscribeProjectTrainingRuns(activeProject.id, user.uid, setProjectRuns);
    const uModels = subscribeProjectTrainedModels(activeProject.id, user.uid, (list) => {
      setTrainedModels(list);
      void cacheModelSnapshots(list);
    });
    return () => {
      uDs();
      uRuns();
      uModels();
    };
  }, [user, activeProject?.id, isOnline]);

  const activeDataset = useMemo(() => {
    if (datasets.length === 0) return null;
    return datasets.find((d) => d.id === selectedDatasetId) || datasets[0];
  }, [datasets, selectedDatasetId]);

  useEffect(() => {
    if (!user || !activeDataset || !isOnline) {
      setItems([]);
      return;
    }
    return subscribeDatasetItems(activeDataset.id, user.uid, setItems);
  }, [user, activeDataset?.id, isOnline]);

  // Capture state
  const [captureSubMode, setCaptureSubMode] = useState<CaptureSubMode>('camera');
  const [newDsName, setNewDsName] = useState('');
  const [newDsClasses, setNewDsClasses] = useState('');
  const [creatingDs, setCreatingDs] = useState(false);

  // Desktop Pairing state
  const [pairedStatus, setPairedStatus] = useState<PairedDesktopReachability | null>(null);
  const [pairingRelayInput, setPairingRelayInput] = useState('http://192.168.1.100:43127');
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingMessage, setPairingMessage] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);

  const probePairing = async () => {
    const res = await checkPairedDesktopReachability();
    setPairedStatus(res);
    return res;
  };

  useEffect(() => {
    void probePairing();
  }, [activeTab]);

  // Training state
  const [execTarget, setExecTarget] = useState<MobileExecutionTarget>('browser');
  const [selectedArch, setSelectedArch] = useState<string>('');
  const [epochs, setEpochs] = useState(12);
  const [learningRate, setLearningRate] = useState(0.001);
  const [trainingActive, setTrainingActive] = useState(false);
  const [trainingPaused, setTrainingPaused] = useState(false);
  const [activeRemoteJobId, setActiveRemoteJobId] = useState<string | null>(null);
  const [liveEpochMetrics, setLiveEpochMetrics] = useState<EpochMetricPoint[]>([]);
  const [trainLogs, setTrainLogs] = useState<string[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const pauseRef = useRef(false);
  const cancelRef = useRef(false);

  const taskModels = useMemo(() => {
    const task = activeProject?.taskType || 'image_classification';
    return getCatalogModelsForTask(task, { trainableOnly: true }).filter((m) =>
      execTarget === 'browser'
        ? m.backendEngine === 'tfjs_browser'
        : m.backendEngine === 'python_fastapi'
    );
  }, [activeProject?.taskType, execTarget]);

  useEffect(() => {
    if (taskModels.length > 0 && !taskModels.some((m) => m.id === selectedArch)) {
      setSelectedArch(taskModels[0].id);
    }
  }, [taskModels, selectedArch]);

  const datasetQuality = useMemo(() => {
    if (!activeDataset || !activeProject) return null;
    return auditDatasetQuality(activeDataset, items, activeProject.taskType);
  }, [activeDataset, activeProject, items]);

  const datasetValidation = useMemo(() => {
    if (!activeDataset || !activeProject) return null;
    return validateDatasetForTraining({
      dataset: activeDataset,
      items,
      taskType: activeProject.taskType,
    });
  }, [activeDataset, activeProject, items]);

  // Model inference & share state
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [inferencePred, setInferencePred] = useState<InferencePrediction | null>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [modelActionMsg, setModelActionMsg] = useState<string | null>(null);

  const displayedModels: TrainedModel[] = useMemo(() => {
    if (isOnline && trainedModels.length > 0) return trainedModels;
    const offlineFiltered = cachedModels
      .map((c) => c.model)
      .filter((m) => !activeProject || m.projectId === activeProject.id);
    return trainedModels.length > 0 ? trainedModels : offlineFiltered;
  }, [isOnline, trainedModels, cachedModels, activeProject?.id]);

  // Handlers
  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeProject) return;
    setCreatingDs(true);
    try {
      const classes = newDsClasses
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const ds = await createDataset({
        ownerUid: user.uid,
        projectId: activeProject.id,
        currentDatasetCount: activeProject.datasetCount,
        name: newDsName.trim() || 'Mobile Capture Set',
        description: 'Captured on MK AI Mobile PWA',
        classes,
      });
      setSelectedDatasetId(ds.id);
      setNewDsName('');
      setNewDsClasses('');
    } finally {
      setCreatingDs(false);
    }
  };

  const handleCleanupDuplicates = async () => {
    if (!activeDataset || !datasetQuality || !activeProject) return;
    for (const grp of datasetQuality.duplicateGroups) {
      for (const duplicateId of grp.itemIds.slice(1)) {
        await deleteDatasetItem(activeDataset.id, duplicateId);
      }
    }
    const remaining = items.filter(
      (it) => !datasetQuality.duplicateGroups.some((g) => g.itemIds.slice(1).includes(it.id))
    );
    await syncDatasetCounters({
      datasetId: activeDataset.id,
      imageCount: remaining.length,
      annotatedCount: remaining.filter((it) =>
        activeProject.taskType === 'image_classification'
          ? Boolean(it.classificationLabel)
          : it.annotations.length > 0
      ).length,
    });
  };

  const handleStartTraining = async () => {
    if (!user || !activeProject || !activeDataset) return;
    setTrainError(null);
    setTrainLogs([]);
    setLiveEpochMetrics([]);
    pauseRef.current = false;
    cancelRef.current = false;
    setTrainingPaused(false);
    setTrainingActive(true);

    const spec = getModelCatalogEntry(selectedArch);
    const recHp = getRecommendedHyperparameters(activeProject.taskType, items.length);
    const hp = {
      ...recHp,
      epochs,
      learningRate,
      inputSize: spec?.recommendedInputSize || recHp.inputSize,
    };

    try {
      if (execTarget === 'browser') {
        const availableIds = await listStoredDatasetBlobIds(activeDataset.id);
        const valCheck = validateDatasetForTraining({
          dataset: activeDataset,
          items,
          taskType: activeProject.taskType,
          availableBlobIds: availableIds,
        });
        if (!valCheck.valid) {
          throw new Error(valCheck.errors.join(' '));
        }

        const runId = `mrun_${Date.now().toString(36)}`;
        const modelId = `mmdl_${Date.now().toString(36)}`;

        if (isOnline) {
          await createTrainingRun({
            runId,
            ownerUid: user.uid,
            projectId: activeProject.id,
            datasetId: activeDataset.id,
            datasetVersion: activeDataset.version,
            taskType: activeProject.taskType,
            backendEngine: 'tfjs_browser',
            architecture: selectedArch,
            trainingMode: activeProject.trainingMode,
            hyperparameters: hp,
            hardwareSummary: 'Mobile PWA TF.js On-Device',
            currentModelCount: activeProject.modelCount,
          });
        }

        const collectedMetrics: EpochMetricPoint[] = [];
        const result = await runBrowserTrainingPipeline({
          runId,
          modelId,
          projectId: activeProject.id,
          taskType: activeProject.taskType,
          architecture: selectedArch,
          dataset: activeDataset,
          items,
          hyperparameters: hp,
          hooks: {
            shouldPause: () => pauseRef.current,
            shouldCancel: () => cancelRef.current,
            onLog: (line) => setTrainLogs((prev) => [...prev.slice(-29), line]),
            onEpoch: async (pt, bestEp, bestVal) => {
              collectedMetrics.push(pt);
              setLiveEpochMetrics([...collectedMetrics]);
              if (isOnline) {
                await updateTrainingRunProgress({
                  runId,
                  status: pauseRef.current ? 'paused' : 'running',
                  currentEpoch: pt.epoch,
                  epochMetrics: [...collectedMetrics],
                  bestEpoch: bestEp,
                  bestValMetric: bestVal,
                  checkpointSaved: hp.saveCheckpoints,
                  hardwareSummary: 'Mobile PWA TF.js On-Device',
                }).catch(() => {});
              }
            },
          },
        });

        if (result.status === 'cancelled') {
          if (isOnline) {
            await updateTrainingRunStatus({
              runId,
              status: 'cancelled',
              completedAt: new Date().toISOString(),
            });
          }
          return;
        }

        if (isOnline) {
          await updateTrainingRunProgress({
            runId,
            status: 'completed',
            currentEpoch: result.epochMetrics.length,
            epochMetrics: result.epochMetrics,
            bestEpoch: result.bestEpoch,
            bestValMetric: result.bestValMetric,
            checkpointSaved: true,
            hardwareSummary: result.hardwareSummary,
            completedAt: new Date().toISOString(),
          });

          await saveTrainedModelRecord({
            modelId,
            runId,
            projectId: activeProject.id,
            datasetId: activeDataset.id,
            datasetVersion: activeDataset.version,
            ownerUid: user.uid,
            name: `${spec?.name || selectedArch} (Mobile)`,
            taskType: activeProject.taskType,
            backendEngine: 'tfjs_browser',
            architecture: selectedArch,
            license: spec?.license || 'Apache-2.0',
            classes: activeDataset.classes,
            inputSize: hp.inputSize,
            parameterCount: result.parameterCount,
            weightSizeBytes: result.weightSizeBytes,
            inferenceLatencyMs: result.inferenceLatencyMs,
            accuracy: result.accuracy,
            precision: result.precision,
            recall: result.recall,
            f1Score: result.f1Score,
            mAP50: result.mAP50,
            confusionLabels: result.confusionLabels,
            confusionFlat: result.confusionFlat,
            perClassMetrics: result.perClassMetrics,
            onDeviceCompatible: true,
            newModelCount: activeProject.modelCount + 1,
          });
        }

        pushNotification({
          category: 'training_completed',
          title: locale === 'ar' ? 'اكتمل التدريب على الهاتف' : 'On-Device Training Completed',
          body: `${spec?.name || selectedArch} · ${
            activeProject.taskType === 'image_classification'
              ? `Accuracy ${(result.accuracy * 100).toFixed(1)}%`
              : `mAP@0.5 ${(result.mAP50 * 100).toFixed(1)}%`
          }`,
          deliverBrowserPush: true,
        });
      } else if (execTarget === 'desktop') {
        const reach = await probePairing();
        if (!reach.paired || !reach.reachable || !reach.engineHealthy) {
          throw new Error(
            reach.error ||
              (locale === 'ar'
                ? 'جهاز الكمبيوتر غير متصل حالياً. يمكنك التحويل إلى Cloud Python أو تدريب الهاتف.'
                : 'Paired Desktop is unreachable or stopped. Switch to Cloud Python or On-Device Mobile.')
          );
        }

        const job = await dispatchPairedDesktopTrainingJob({
          projectId: activeProject.id,
          datasetId: activeDataset.id,
          taskType: activeProject.taskType,
          architecture: selectedArch,
          classes: activeDataset.classes,
          hyperparameters: hp,
        });
        const jobId = String(job.job_id || '');
        setActiveRemoteJobId(jobId);

        let finished = false;
        while (!finished && !cancelRef.current) {
          await new Promise((r) => setTimeout(r, 1500));
          const latest = await fetchPairedDesktopTrainingJob(jobId);
          if (Array.isArray(latest.epochMetrics)) {
            setLiveEpochMetrics(latest.epochMetrics as EpochMetricPoint[]);
          }
          if (Array.isArray(latest.logs)) {
            setTrainLogs((latest.logs as unknown[]).map(String).slice(-25));
          }
          const st = String(latest.status || '');
          if (st === 'completed' || st === 'failed' || st === 'cancelled') {
            finished = true;
            if (st === 'failed') {
              throw new Error(String(latest.errorMessage || 'Desktop training job failed.'));
            }
            if (st === 'completed') {
              pushNotification({
                category: 'training_completed',
                title:
                  locale === 'ar'
                    ? 'اكتمل التدريب على سطح المكتب المقترن'
                    : 'Paired Desktop Training Complete',
                body: `${spec?.name || selectedArch} (${reach.hardwareSummary || 'Desktop'})`,
                deliverBrowserPush: true,
              });
            }
          }
        }
      } else {
        const ping = await pingAiEngine();
        if (!ping.reachable) {
          throw new Error(ping.message || 'Cloud Python worker is offline.');
        }
        const job = await startPythonTrainingJob({
          projectId: activeProject.id,
          datasetId: activeDataset.id,
          taskType: activeProject.taskType,
          architecture: selectedArch,
          classes: activeDataset.classes,
          hyperparameters: hp,
        });
        setActiveRemoteJobId(job.job_id);
        let finished = false;
        while (!finished && !cancelRef.current) {
          await new Promise((r) => setTimeout(r, 1500));
          const latest = await fetchPythonTrainingJob(job.job_id);
          setLiveEpochMetrics(latest.epochMetrics || []);
          setTrainLogs((latest.logs || []).slice(-25));
          if (['completed', 'failed', 'cancelled'].includes(latest.status)) {
            finished = true;
            if (latest.status === 'failed') {
              throw new Error(latest.errorMessage || 'Cloud Python training failed.');
            }
            if (latest.status === 'completed') {
              pushNotification({
                category: 'training_completed',
                title: locale === 'ar' ? 'اكتمل التدريب السحابي' : 'Cloud Python Training Complete',
                body: `${spec?.name || selectedArch}`,
                deliverBrowserPush: true,
              });
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Training failed.';
      setTrainError(msg);
      pushNotification({
        category: 'training_failed',
        title: locale === 'ar' ? 'فشل التدريب' : 'Training Failed',
        body: msg,
        deliverBrowserPush: true,
      });
    } finally {
      setTrainingActive(false);
      setActiveRemoteJobId(null);
      setTrainingPaused(false);
    }
  };

  const handleControlTraining = async (action: 'pause' | 'resume' | 'cancel') => {
    if (execTarget === 'browser') {
      if (action === 'pause') {
        pauseRef.current = true;
        setTrainingPaused(true);
      } else if (action === 'resume') {
        pauseRef.current = false;
        setTrainingPaused(false);
      } else {
        cancelRef.current = true;
        pauseRef.current = false;
      }
      return;
    }

    if (!activeRemoteJobId) return;
    if (action === 'pause') setTrainingPaused(true);
    if (action === 'resume') setTrainingPaused(false);
    if (action === 'cancel') cancelRef.current = true;

    if (execTarget === 'desktop') {
      await controlPairedDesktopTrainingJob(activeRemoteJobId, action).catch(() => {});
    } else {
      await controlPythonTrainingJob(activeRemoteJobId, action).catch(() => {});
    }
  };

  const handleTestModelImage = async (model: TrainedModel, file: File | null) => {
    if (!file) return;
    setInferenceError(null);
    setInferencePred(null);
    setTestingModelId(model.id);

    try {
      const loaded = await loadTfModelFromIndexedDb(model.id);
      if (!loaded) {
        throw new Error(
          locale === 'ar'
            ? 'أوزان هذا النموذج غير مخزنة محلياً على هذا الجهاز بعد.'
            : 'Model weights are not cached locally in IndexedDB on this device.'
        );
      }
      try {
        const pred = await predictImageWithLocalModel({
          model: loaded.model,
          taskType: model.taskType,
          classes: model.classes,
          inputSize: model.inputSize,
          imageBlob: file,
          confidenceThreshold: 0.3,
          iouThreshold: 0.45,
          preprocessMode: loaded.record.preprocessMode,
        });
        setInferencePred(pred);
      } finally {
        loaded.model.dispose();
      }
    } catch (err) {
      setInferenceError(err instanceof Error ? err.message : 'Inference failed.');
    }
  };

  const handlePairDesktop = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairingBusy(true);
    setPairingMessage(null);
    setPairingError(null);
    try {
      const paired = await pairWithDesktopCompanion({
        relayUrl: pairingRelayInput,
        code: pairingCodeInput,
      });
      setPairingCodeInput('');
      setPairingMessage(
        locale === 'ar'
          ? `تم الاقتران بنجاح مع ${paired.deviceName}.`
          : `Paired securely with ${paired.deviceName}.`
      );
      pushNotification({
        category: 'desktop_paired',
        title: locale === 'ar' ? 'تم ربط تطبيق سطح المكتب' : 'Desktop Companion Paired',
        body: paired.relayUrl,
      });
      await probePairing();
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : 'Pairing failed.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleFlushQueue = async () => {
    setSyncingQueue(true);
    try {
      const res = await flushOfflineSyncQueue();
      await refreshOfflineState();
      if (res.succeeded > 0) {
        pushNotification({
          category: 'sync_completed',
          title: locale === 'ar' ? 'تمت مزامنة العناصر المعلقة' : 'Offline Queue Synced',
          body: `${res.succeeded} item(s) synced`,
        });
      }
    } finally {
      setSyncingQueue(false);
    }
  };

  // ==================== TAB 1: HOME ====================
  if (activeTab === 'home') {
    const activeRunsCount = trainingRuns.filter(
      (r) => r.status === 'running' || r.status === 'queued'
    ).length;

    return (
      <div className="space-y-4">
        {/* Active Project Selector */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {locale === 'ar' ? 'المشروع النشط' : 'Active Project'}
            </span>
            <button
              type="button"
              onClick={onCreateProject}
              className="min-h-[44px] px-3 rounded-lg bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <FolderPlus className="w-4 h-4" />
              <span>{locale === 'ar' ? 'مشروع جديد' : 'New'}</span>
            </button>
          </div>

          {mergedProjects.length > 0 ? (
            <select
              value={activeProject?.id || ''}
              onChange={(e) => onSelectProject(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-semibold"
            >
              {mergedProjects.map(({ project, syncState }) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({syncState === 'cached_offline' ? 'Cached Offline' : 'Synced'})
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-zinc-500">
              {locale === 'ar'
                ? 'لا توجد مشروعات بعد. أنشئ مشروعاً جديداً للبدء.'
                : 'No projects yet. Tap New to create your first computer vision project.'}
            </p>
          )}

          {activeProject && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-500 pt-1">
              <span>{activeProject.taskType}</span>
              <span>
                {isOnline
                  ? locale === 'ar'
                    ? 'متزامن مع السحابة'
                    : 'Synced'
                  : locale === 'ar'
                  ? 'نسخة أوفلاين محفوظة'
                  : 'Cached Offline'}
              </span>
            </div>
          )}
        </section>

        {/* 4 Mobile KPIs */}
        <section className="grid grid-cols-2 gap-3 tabular-nums">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
            <div className="text-[11px] text-zinc-500">
              {locale === 'ar' ? 'المشروعات' : 'Projects'}
            </div>
            <div className="text-xl font-display font-bold mt-0.5">{mergedProjects.length}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
            <div className="text-[11px] text-zinc-500">
              {locale === 'ar' ? 'الصور النشطة' : 'Dataset Samples'}
            </div>
            <div className="text-xl font-display font-bold mt-0.5">{items.length}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
            <div className="text-[11px] text-zinc-500">
              {locale === 'ar' ? 'النماذج المدربة' : 'Trained Models'}
            </div>
            <div className="text-xl font-display font-bold mt-0.5">
              {displayedModels.length}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5">
            <div className="text-[11px] text-zinc-500">
              {locale === 'ar' ? 'قائمة المزامنة' : 'Offline Queue'}
            </div>
            <div className="text-xl font-display font-bold mt-0.5 text-amber-600 dark:text-amber-400">
              {syncQueue.length}
            </div>
          </div>
        </section>

        {/* Quick Thumb Actions */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2.5">
          <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {locale === 'ar' ? 'إجراءات سريعة' : 'Quick Actions'}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onSelectTab('capture')}
              className="min-h-[48px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Camera className="w-4 h-4 text-red-600" />
              <span>{locale === 'ar' ? 'التقاط وتعليق' : 'Capture & Label'}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('train')}
              className="min-h-[48px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Cpu className="w-4 h-4 text-red-600" />
              <span>{locale === 'ar' ? 'تشغيل التدريب' : 'Train Model'}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('models')}
              className="min-h-[48px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Sparkles className="w-4 h-4 text-red-600" />
              <span>{locale === 'ar' ? 'اختبار ومشاركة' : 'Test & Export'}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('more')}
              className="min-h-[48px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Link2 className="w-4 h-4 text-red-600" />
              <span>{locale === 'ar' ? 'ربط سطح المكتب' : 'Pair Desktop'}</span>
            </button>
          </div>
        </section>

        {/* Paired Desktop & Credits Summary */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              {locale === 'ar' ? 'محرك التنفيذ المتاح' : 'Execution Status'}
            </span>
            <span className="font-mono text-[11px] text-zinc-500">
              {activeRunsCount > 0 ? `${activeRunsCount} running` : 'Ready'}
            </span>
          </div>
          <div className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
            Mobile: Browser TF.js · Desktop:{' '}
            {pairedStatus?.paired
              ? pairedStatus.reachable
                ? `Connected (${pairedStatus.hardwareSummary || 'Online'})`
                : 'Paired (Unreachable)'
              : 'Not Paired'}
          </div>
          <div className="font-mono text-[11px] text-zinc-500">
            Cloud Credits: {profile?.cloudCreditsBalance ?? 100} · Alerts: {unreadCount}
          </div>
        </section>
      </div>
    );
  }

  // ==================== TAB 2: CAPTURE & ANNOTATE ====================
  if (activeTab === 'capture') {
    return (
      <div className="space-y-4">
        {!activeProject ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 text-center space-y-3 bg-white dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">
              {locale === 'ar'
                ? 'اختر أو أنشئ مشروعاً لبدء التقاط البيانات.'
                : 'Select or create a project first to capture and label images.'}
            </p>
            <button
              type="button"
              onClick={onCreateProject}
              className="min-h-[44px] px-4 rounded-lg bg-red-600 text-white text-xs font-semibold"
            >
              {locale === 'ar' ? 'إنشاء مشروع' : 'Create Project'}
            </button>
          </div>
        ) : (
          <>
            {/* Dataset Selector */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  {locale === 'ar' ? 'مجموعة البيانات' : 'Dataset'}
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  {items.length} {locale === 'ar' ? 'عينة' : 'samples'}
                </span>
              </div>

              {datasets.length > 0 ? (
                <select
                  value={activeDataset?.id || ''}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-semibold"
                >
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} (v{d.version})
                    </option>
                  ))}
                </select>
              ) : (
                <form onSubmit={(e) => void handleCreateDataset(e)} className="space-y-2">
                  <input
                    type="text"
                    required
                    value={newDsName}
                    onChange={(e) => setNewDsName(e.target.value)}
                    placeholder={locale === 'ar' ? 'اسم مجموعة البيانات...' : 'Dataset name...'}
                    className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                  />
                  <input
                    type="text"
                    value={newDsClasses}
                    onChange={(e) => setNewDsClasses(e.target.value)}
                    placeholder={
                      locale === 'ar'
                        ? 'الفئات مفصولة بفاصلة (مثال: defect, ok)'
                        : 'Classes comma-separated (e.g. defect, ok)'
                    }
                    className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={creatingDs}
                    className="w-full min-h-[44px] rounded-lg bg-red-600 text-white text-xs font-semibold"
                  >
                    {creatingDs
                      ? '...'
                      : locale === 'ar'
                      ? 'إنشاء مجموعة بيانات'
                      : 'Create Dataset'}
                  </button>
                </form>
              )}
            </div>

            {activeDataset && (
              <>
                {/* Sub-mode Segmented Control */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  {(
                    [
                      { id: 'camera', en: 'Camera', ar: 'كاميرا' },
                      { id: 'annotate', en: 'Annotate', ar: 'تعليق' },
                      { id: 'quality', en: 'Quality', ar: 'الجودة' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setCaptureSubMode(tab.id)}
                      className={`min-h-[44px] rounded-lg text-xs font-semibold transition-colors ${
                        captureSubMode === tab.id
                          ? 'bg-white dark:bg-zinc-950 text-red-600 shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {locale === 'ar' ? tab.ar : tab.en}
                    </button>
                  ))}
                </div>

                {captureSubMode === 'camera' && (
                  <MobileCameraCapture
                    project={activeProject}
                    dataset={activeDataset}
                    items={items}
                    isOnline={isOnline}
                    onItemSaved={() => void refreshOfflineState()}
                  />
                )}

                {captureSubMode === 'annotate' && (
                  <MobileBboxAnnotator
                    project={activeProject}
                    dataset={activeDataset}
                    items={items}
                    isOnline={isOnline}
                  />
                )}

                {captureSubMode === 'quality' && datasetQuality && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3 text-xs tabular-nums">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {locale === 'ar' ? 'تقرير جودة البيانات' : 'Dataset Quality Audit'}
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                        <div className="text-[11px] text-zinc-500">Annotated</div>
                        <div className="font-mono font-semibold text-sm">
                          {datasetQuality.annotatedImages} / {datasetQuality.totalImages}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                        <div className="text-[11px] text-zinc-500">Duplicates</div>
                        <div className="font-mono font-semibold text-sm">
                          {datasetQuality.duplicateGroups.length}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                        <div className="text-[11px] text-zinc-500">Blurry</div>
                        <div className="font-mono font-semibold text-sm">
                          {datasetQuality.blurryImageIds.length}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                        <div className="text-[11px] text-zinc-500">Low Res</div>
                        <div className="font-mono font-semibold text-sm">
                          {datasetQuality.lowResolutionIds.length}
                        </div>
                      </div>
                    </div>

                    {datasetQuality.duplicateGroups.length > 0 && isOnline && (
                      <button
                        type="button"
                        onClick={() => void handleCleanupDuplicates()}
                        className="w-full min-h-[44px] rounded-lg border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 font-semibold"
                      >
                        {locale === 'ar'
                          ? 'إزالة الصور المكررة (SHA-256)'
                          : 'Clean Duplicate Images (SHA-256)'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // ==================== TAB 3: TRAIN ====================
  if (activeTab === 'train') {
    const displayedEpochs =
      liveEpochMetrics.length > 0
        ? liveEpochMetrics
        : projectRuns[0]?.epochMetrics || [];

    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {locale === 'ar' ? 'بيئة تنفيذ التدريب' : 'Training Execution Target'}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'browser', en: 'Mobile TF.js', ar: 'المتصفح' },
                { id: 'desktop', en: 'Desktop GPU', ar: 'سطح المكتب' },
                { id: 'cloud', en: 'Cloud Python', ar: 'السحابة' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={trainingActive}
                onClick={() => setExecTarget(opt.id)}
                className={`min-h-[44px] px-2 rounded-lg text-xs font-semibold border transition-colors ${
                  execTarget === opt.id
                    ? 'bg-red-600 text-white border-red-600'
                    : 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                {locale === 'ar' ? opt.ar : opt.en}
              </button>
            ))}
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            {execTarget === 'browser'
              ? locale === 'ar'
                ? 'التدريب يتم مباشرة داخل متصفح الهاتف عبر TensorFlow.js (لا يتطلب بايثون أو CUDA).'
                : 'Runs locally inside mobile browser via TensorFlow.js. CUDA/PyTorch models require Paired Desktop or Cloud Python.'
              : execTarget === 'desktop'
              ? pairedStatus?.paired
                ? pairedStatus.reachable
                  ? `Paired Desktop: ${pairedStatus.hardwareSummary || 'Online'}`
                  : 'Paired Desktop offline — switch to Cloud Python or Browser TF.js.'
                : 'No Desktop paired yet. Pair in More tab first.'
              : 'Uses hosted Cloud Python FastAPI worker when configured.'}
          </p>
        </section>

        {/* Architecture & Hyperparameters */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1.5">
              {locale === 'ar' ? 'معمارية النموذج' : 'Architecture'}
            </label>
            <select
              value={selectedArch}
              disabled={trainingActive}
              onChange={(e) => setSelectedArch(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-medium"
            >
              {taskModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.recommendedInputSize}px)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 tabular-nums">
            <div>
              <label className="block font-semibold mb-1">Epochs</label>
              <input
                type="number"
                min={2}
                max={100}
                value={epochs}
                disabled={trainingActive}
                onChange={(e) => setEpochs(Math.max(2, Math.min(100, Number(e.target.value) || 2)))}
                className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Learning Rate</label>
              <input
                type="number"
                step="0.0002"
                min={0.0001}
                max={0.1}
                value={learningRate}
                disabled={trainingActive}
                onChange={(e) => setLearningRate(Number(e.target.value) || 0.001)}
                className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
              />
            </div>
          </div>

          {datasetValidation && !datasetValidation.valid && (
            <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
              {datasetValidation.errors.map((err) => (
                <div key={err}>• {err}</div>
              ))}
            </div>
          )}

          {!trainingActive ? (
            <button
              type="button"
              disabled={!activeProject || !activeDataset}
              onClick={() => void handleStartTraining()}
              className="w-full min-h-[48px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-45"
            >
              <Play className="w-4 h-4" />
              <span>{locale === 'ar' ? 'بدء التدريب الحقيقي' : 'Start Real Training'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void handleControlTraining(trainingPaused ? 'resume' : 'pause')
                }
                className="min-h-[48px] flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center justify-center gap-2"
              >
                {trainingPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                <span>{trainingPaused ? 'Resume' : 'Pause'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleControlTraining('cancel')}
                className="min-h-[48px] px-4 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold inline-flex items-center justify-center gap-2"
              >
                <Square className="w-4 h-4" />
                <span>Cancel</span>
              </button>
            </div>
          )}

          {trainError && (
            <div className="p-3 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-400">
              {trainError}
            </div>
          )}
        </section>

        {/* Live Epoch Table & Logs */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-red-600" />
              <span>{locale === 'ar' ? 'تقدم التدريب المباشر' : 'Live Epoch Metrics'}</span>
            </span>
            <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
              {displayedEpochs.length} epochs
            </span>
          </div>

          {displayedEpochs.length > 0 ? (
            <div className="max-h-48 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 font-mono text-[11px] tabular-nums">
              {displayedEpochs
                .slice()
                .reverse()
                .map((pt) => (
                  <div key={pt.epoch} className="py-1.5 flex items-center justify-between gap-2">
                    <span>Epoch {pt.epoch}</span>
                    <span>Loss {pt.trainLoss.toFixed(4)}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Val {(pt.valMetric * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">
              {locale === 'ar' ? 'لا توجد نقاط تدريب مسجلة بعد.' : 'No epoch metrics recorded yet.'}
            </p>
          )}

          {trainLogs.length > 0 && (
            <div className="p-2.5 rounded-lg bg-zinc-950 text-zinc-200 font-mono text-[10px] max-h-32 overflow-y-auto space-y-1">
              {trainLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  // ==================== TAB 4: MODELS ====================
  if (activeTab === 'models') {
    return (
      <div className="space-y-4">
        {modelActionMsg && (
          <div className="p-3 rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 text-xs text-emerald-800 dark:text-emerald-300">
            {modelActionMsg}
          </div>
        )}
        {inferenceError && (
          <div className="p-3 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-400">
            {inferenceError}
          </div>
        )}

        {inferencePred && (
          <section className="rounded-xl border border-red-300 dark:border-red-900 bg-white dark:bg-zinc-900 p-4 space-y-2 text-xs tabular-nums">
            <div className="flex items-center justify-between font-semibold">
              <span>{locale === 'ar' ? 'نتيجة الاختبار على الجهاز' : 'On-Device Inference'}</span>
              <span className="font-mono text-zinc-500">{inferencePred.latencyMs} ms</span>
            </div>
            {inferencePred.classifications.slice(0, 3).map((c) => (
              <div key={c.className} className="flex items-center justify-between font-mono">
                <span>{c.className}</span>
                <span>{(c.confidence * 100).toFixed(1)}%</span>
              </div>
            ))}
            {inferencePred.detections.map((d, idx) => (
              <div key={idx} className="flex items-center justify-between font-mono">
                <span>{d.className}</span>
                <span>{(d.confidence * 100).toFixed(1)}%</span>
              </div>
            ))}
          </section>
        )}

        {displayedModels.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-center space-y-3">
            <p className="text-xs text-zinc-500">
              {locale === 'ar'
                ? 'لا توجد نماذج مدربة لهذا المشروع بعد.'
                : 'No trained models available for this project yet.'}
            </p>
            <button
              type="button"
              onClick={() => onSelectTab('train')}
              className="min-h-[44px] px-4 rounded-lg bg-red-600 text-white text-xs font-semibold"
            >
              {locale === 'ar' ? 'ابدأ التدريب' : 'Train a Model'}
            </button>
          </div>
        ) : (
          displayedModels.map((model) => (
            <section
              key={model.id}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3 text-xs tabular-nums"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display font-bold text-sm text-zinc-900 dark:text-zinc-100">
                    {model.name}
                  </div>
                  <div className="font-mono text-[11px] text-zinc-500">
                    {model.architecture} · {model.backendEngine} · {formatBytes(model.weightSizeBytes)}
                  </div>
                </div>
                {model.isActive && (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-semibold text-[11px]">
                    Active
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono">
                <div className="p-2 rounded border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-500">
                    {model.taskType === 'image_classification' ? 'Accuracy' : 'mAP@0.5'}
                  </div>
                  <div className="font-semibold">
                    {((model.taskType === 'image_classification' ? model.accuracy : model.mAP50) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="p-2 rounded border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-500">F1 Score</div>
                  <div className="font-semibold">{(model.f1Score * 100).toFixed(1)}%</div>
                </div>
                <div className="p-2 rounded border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[10px] text-zinc-500">Latency</div>
                  <div className="font-semibold">{model.inferenceLatencyMs} ms</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {model.onDeviceCompatible && (
                  <label className="min-h-[44px] flex-1 px-3 rounded-lg bg-red-600 text-white font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
                    <Camera className="w-4 h-4" />
                    <span>
                      {testingModelId === model.id && inferencePred
                        ? locale === 'ar'
                          ? 'إعادة الاختبار'
                          : 'Test Again'
                        : locale === 'ar'
                        ? 'اختبار بصورة'
                        : 'Test Image'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        void handleTestModelImage(model, file);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const card = generateModelCardReport(model);
                    void shareOrDownloadText(
                      `${model.id}_report.json`,
                      card.json,
                      'application/json',
                      `${model.name} Report`
                    ).then((mode) =>
                      setModelActionMsg(
                        mode === 'shared'
                          ? 'Opened native share sheet.'
                          : 'Downloaded model report JSON.'
                      )
                    );
                  }}
                  className="min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center gap-1.5"
                >
                  <Share2 className="w-4 h-4" />
                  <span>{locale === 'ar' ? 'مشاركة التقرير' : 'Share Card'}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void exportPortableMkModelBundle(model).then((res) => {
                      if (!res) {
                        setInferenceError(
                          locale === 'ar'
                            ? 'حزمة الأوزان غير مخزنة محلياً على هذا الجهاز.'
                            : 'Model weights are not cached locally on this device.'
                        );
                        return;
                      }
                      void shareOrDownloadText(
                        res.filename,
                        res.bundleJson,
                        'application/json',
                        `${model.name} Bundle`
                      );
                    })
                  }
                  className="min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>.mkmodel</span>
                </button>

                {!model.isActive && isOnline && (
                  <button
                    type="button"
                    onClick={() =>
                      void setActiveTrainedModel(trainedModels, model.id)
                    }
                    className="min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Activate</span>
                  </button>
                )}
              </div>
            </section>
          ))
        )}
      </div>
    );
  }

  // ==================== TAB 5: MORE (PWA, PAIRING, OFFLINE, SETTINGS) ====================
  const storedPairing = getStoredDesktopPairing();

  return (
    <div className="space-y-4 text-xs">
      {/* PWA Install & Update */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
          {locale === 'ar' ? 'تثبيت وتحديث التطبيق (PWA)' : 'Mobile App Install & Updates'}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PWAInstallButton />
          <button
            type="button"
            disabled={checkingUpdate}
            onClick={() => {
              if (updateAvailable) {
                void onApplyUpdate();
              } else {
                void onCheckForUpdates();
              }
            }}
            className="min-h-[44px] px-3.5 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin' : ''}`} />
            <span>
              {updateAvailable
                ? locale === 'ar'
                  ? 'تطبيق التحديث الآن'
                  : 'Install Update'
                : locale === 'ar'
                ? 'فحص التحديثات'
                : 'Check Updates'}
            </span>
          </button>
        </div>
      </section>

      {/* Desktop Companion Pairing */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-red-600" />
            <span>
              {locale === 'ar'
                ? 'الاقتران مع MK AI Desktop'
                : 'MK AI Desktop Companion Pairing'}
            </span>
          </div>
          {storedPairing && (
            <button
              type="button"
              onClick={() => {
                clearStoredDesktopPairing();
                void probePairing();
              }}
              className="min-h-[44px] px-2.5 rounded-lg border border-red-300 dark:border-red-900 text-red-600 font-semibold inline-flex items-center gap-1"
            >
              <Unlink className="w-3.5 h-3.5" />
              <span>{locale === 'ar' ? 'فك الارتباط' : 'Unpair'}</span>
            </button>
          )}
        </div>

        <p className="text-[11px] text-zinc-500 leading-relaxed">
          {locale === 'ar'
            ? 'اقترن برمز مؤقت قصير العمر لتنفيذ تدريب PyTorch / CUDA على جهازك. بيانات اعتماد المحرك المحلية تبقى حصراً على سطح المكتب.'
            : 'Pairs using a short-lived code exchanged for a revocable device session token. Desktop engine credentials stay strictly on Desktop.'}
        </p>

        {storedPairing ? (
          <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 space-y-1.5 font-mono text-[11px]">
            <div>Relay: {storedPairing.relayUrl}</div>
            <div>
              Status:{' '}
              {pairedStatus?.reachable
                ? `Connected (${pairedStatus.hardwareSummary || 'Engine Ready'})`
                : 'Unreachable (Cloud Python fallback active)'}
            </div>
            <button
              type="button"
              onClick={() => void probePairing()}
              className="min-h-[44px] mt-1 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{locale === 'ar' ? 'فحص الاتصال' : 'Test Connection'}</span>
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handlePairDesktop(e)} className="space-y-2">
            <input
              type="url"
              required
              value={pairingRelayInput}
              onChange={(e) => setPairingRelayInput(e.target.value)}
              placeholder="http://192.168.1.100:43127"
              className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
            />
            <input
              type="text"
              required
              value={pairingCodeInput}
              onChange={(e) => setPairingCodeInput(e.target.value.toUpperCase())}
              placeholder={locale === 'ar' ? 'رمز الاقتران (8 خانات)' : '8-char Pairing Code'}
              className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono uppercase tracking-widest"
            />
            <button
              type="submit"
              disabled={pairingBusy}
              className="w-full min-h-[44px] rounded-lg bg-red-600 text-white font-semibold"
            >
              {pairingBusy
                ? '...'
                : locale === 'ar'
                ? 'ربط جهاز سطح المكتب'
                : 'Pair Desktop Companion'}
            </button>
          </form>
        )}

        {pairingMessage && <p className="text-emerald-700 dark:text-emerald-400">{pairingMessage}</p>}
        {pairingError && <p className="text-red-600 dark:text-red-400">{pairingError}</p>}
      </section>

      {/* Offline Queue & Storage Quota */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-red-600" />
            <span>
              {locale === 'ar' ? 'التخزين والمزامنة أوفلاين' : 'Offline Storage & Sync Queue'}
            </span>
          </div>
          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
            {syncQueue.length} pending
          </span>
        </div>

        {quota?.supported && (
          <div className="space-y-1 tabular-nums">
            <div className="flex justify-between font-mono text-[11px] text-zinc-500">
              <span>{formatBytes(quota.usageBytes)} used</span>
              <span>{formatBytes(quota.quotaBytes)} quota ({quota.percentUsed}%)</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                style={{ width: `${Math.min(100, quota.percentUsed)}%` }}
                className="h-full bg-red-600"
              />
            </div>
          </div>
        )}

        {syncQueue.length > 0 && (
          <div className="space-y-2">
            {syncQueue.map((entry) => (
              <div
                key={entry.id}
                className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">{entry.type}</div>
                  <div className="font-mono text-[10px] text-zinc-500 truncate">
                    {entry.status} {entry.lastError ? `· ${entry.lastError}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void removeOfflineSyncEntry(entry.id).then(() => refreshOfflineState())
                  }
                  aria-label="Delete queued item"
                  className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            <button
              type="button"
              disabled={!isOnline || syncingQueue}
              onClick={() => void handleFlushQueue()}
              className="w-full min-h-[44px] rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-45"
            >
              <UploadCloud className="w-4 h-4" />
              <span>{syncingQueue ? 'Syncing...' : 'Sync Queue Now'}</span>
            </button>
          </div>
        )}
      </section>

      {/* Preferences, Notifications & Account */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}
            className="min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold"
          >
            {locale === 'en' ? 'العربية' : 'English'}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center justify-center gap-1.5"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenNotifications}
          className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center justify-between"
        >
          <span className="inline-flex items-center gap-2">
            <Bell className="w-4 h-4 text-red-600" />
            <span>{locale === 'ar' ? 'مركز الإشعارات' : 'Notifications Center'}</span>
          </span>
          <span className="font-mono text-[11px] text-zinc-500">
            {browserPermission === 'granted' ? 'Push On' : `${unreadCount} unread`}
          </span>
        </button>

        {browserPermission === 'default' && (
          <button
            type="button"
            onClick={() => void requestBrowserPermission()}
            className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>
              {locale === 'ar' ? 'تفعيل إشعارات الجهاز' : 'Enable Device Push Alerts'}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onSwitchToDesktopLayout}
          className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-semibold inline-flex items-center justify-center gap-2"
        >
          <Laptop className="w-4 h-4" />
          <span>
            {locale === 'ar' ? 'فتح واجهة سطح المكتب الكاملة' : 'Switch to Full Desktop Layout'}
          </span>
        </button>

        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold truncate">{profile?.displayName || user?.email}</div>
            <div className="text-[11px] text-zinc-500 truncate">{user?.email}</div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="min-h-[44px] px-3 rounded-lg border border-red-300 dark:border-red-900 text-red-600 font-semibold inline-flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span>{locale === 'ar' ? 'خروج' : 'Sign Out'}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
