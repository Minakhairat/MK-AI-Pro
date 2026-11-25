import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Download,
  Pause,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import {
  controlPythonTrainingJob,
  fetchPythonTrainingJob,
  pingAiEngine,
  startPythonTrainingJob,
} from '../../lib/apiClient';
import {
  exportStoredModelArtifacts,
  loadTfModelFromIndexedDb,
} from '../../lib/localModelStore';
import {
  getRecommendedHyperparameters,
  MODEL_ARCHITECTURES,
  predictImageWithLocalModel,
  runBrowserTrainingPipeline,
} from '../../lib/tfTrainer';
import {
  createTrainingRun,
  deleteTrainedModel,
  logActivity,
  saveTrainedModelRecord,
  setActiveTrainedModel,
  updateTrainingRunProgress,
  updateTrainingRunStatus,
} from '../../services/firestoreService';
import type {
  AiEnginePingResponse,
  Dataset,
  DatasetItem,
  EpochMetricPoint,
  InferencePrediction,
  Project,
  TrainedModel,
  TrainingHyperparameters,
  TrainingMode,
  TrainingRun,
} from '../../types/domain';

interface TrainingStudioProps {
  project: Project;
  datasets: Dataset[];
  activeDataset: Dataset | null;
  items: DatasetItem[];
  trainingRuns: TrainingRun[];
  trainedModels: TrainedModel[];
  onSelectDataset: (datasetId: string) => void;
}

function makeClientId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${raw.slice(0, 20)}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function EpochLineChart({
  title,
  points,
  primaryKey,
  secondaryKey,
  primaryLabel,
  secondaryLabel,
  isPercent,
}: {
  title: string;
  points: EpochMetricPoint[];
  primaryKey: 'trainLoss' | 'trainMetric';
  secondaryKey: 'valLoss' | 'valMetric';
  primaryLabel: string;
  secondaryLabel: string;
  isPercent?: boolean;
}) {
  const width = 460;
  const height = 180;
  const padX = 36;
  const padY = 20;

  const allVals = points.flatMap((p) => [p[primaryKey], p[secondaryKey]]);
  const minVal = isPercent ? 0 : Math.min(0, ...(allVals.length ? allVals : [0]));
  const maxRaw = allVals.length ? Math.max(...allVals) : 1;
  const maxVal = isPercent ? 1 : Math.max(0.05, maxRaw * 1.12);

  const toX = (idx: number) => {
    if (points.length <= 1) return padX;
    return padX + (idx / (points.length - 1)) * (width - padX * 2);
  };
  const toY = (val: number) => {
    const ratio = (val - minVal) / (maxVal - minVal || 1);
    return height - padY - ratio * (height - padY * 2);
  };

  const buildPath = (key: 'trainLoss' | 'valLoss' | 'trainMetric' | 'valMetric') =>
    points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${toX(idx).toFixed(1)},${toY(p[key]).toFixed(1)}`)
      .join(' ');

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-900 space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-red-600 inline-block" />
            {primaryLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-zinc-500 dark:bg-zinc-400 inline-block" />
            {secondaryLabel}
          </span>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="h-[180px] flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg">
          —
        </div>
      ) : (
        <div dir="ltr">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[180px]">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = padY + t * (height - padY * 2);
              const labelVal = maxVal - t * (maxVal - minVal);
              return (
                <g key={t}>
                  <line
                    x1={padX}
                    x2={width - padX}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    className="text-zinc-200 dark:text-zinc-800"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={4}
                    y={y + 3}
                    fontSize="9"
                    fill="currentColor"
                    className="text-zinc-400 font-mono"
                  >
                    {isPercent ? `${Math.round(labelVal * 100)}%` : labelVal.toFixed(2)}
                  </text>
                </g>
              );
            })}
            <path
              d={buildPath(secondaryKey)}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="4 2"
              className="text-zinc-500 dark:text-zinc-400"
            />
            <path
              d={buildPath(primaryKey)}
              fill="none"
              stroke="#DC2626"
              strokeWidth="2.5"
            />
            {points.map((p, idx) => (
              <circle
                key={p.epoch}
                cx={toX(idx)}
                cy={toY(p[primaryKey])}
                r="3"
                fill="#DC2626"
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

export function TrainingStudio({
  project,
  datasets,
  activeDataset,
  items,
  trainingRuns,
  trainedModels,
  onSelectDataset,
}: TrainingStudioProps) {
  const { t, locale } = useI18n();

  const taskArchitectures = useMemo(
    () => MODEL_ARCHITECTURES.filter((a) => a.taskType === project.taskType),
    [project.taskType]
  );

  const [selectedArchId, setSelectedArchId] = useState<string>(
    taskArchitectures[0]?.id || 'mk_mobilenet_sep'
  );
  const [mode, setMode] = useState<TrainingMode>(project.trainingMode);
  const [hp, setHp] = useState<TrainingHyperparameters>(() =>
    getRecommendedHyperparameters(project.taskType, items.length)
  );

  useEffect(() => {
    const first = taskArchitectures[0];
    if (first && !taskArchitectures.some((a) => a.id === selectedArchId)) {
      setSelectedArchId(first.id);
    }
  }, [taskArchitectures, selectedArchId]);

  useEffect(() => {
    setMode(project.trainingMode);
  }, [project.trainingMode]);

  const selectedArch =
    taskArchitectures.find((a) => a.id === selectedArchId) || taskArchitectures[0];

  useEffect(() => {
    if (mode === 'beginner') {
      const rec = getRecommendedHyperparameters(project.taskType, items.length);
      if (selectedArch) {
        rec.inputSize = selectedArch.recommendedInputSize;
      }
      setHp(rec);
    }
  }, [mode, project.taskType, items.length, selectedArch?.id]);

  // Python worker live probe
  const [probingEngine, setProbingEngine] = useState(false);
  const [engineStatus, setEngineStatus] = useState<AiEnginePingResponse | null>(null);

  const handleProbeEngine = async () => {
    setProbingEngine(true);
    try {
      const res = await pingAiEngine();
      setEngineStatus(res);
    } catch (err) {
      setEngineStatus({
        reachable: false,
        status: 'error',
        message: err instanceof Error ? err.message : 'Probe failed',
        hardware: null,
      });
    } finally {
      setProbingEngine(false);
    }
  };

  // Dataset Readiness
  const readiness = useMemo(() => {
    if (!activeDataset) {
      return { ready: false, reason: t.trainingStudio.datasetGateEmpty, trainCount: 0, valCount: 0, testCount: 0 };
    }
    const isAnnotated = (it: DatasetItem) =>
      project.taskType === 'image_classification'
        ? it.classificationLabel.trim().length > 0 && activeDataset.classes.includes(it.classificationLabel)
        : it.annotations.some((b) => activeDataset.classes.includes(b.className));

    const trainCount = items.filter((it) => it.split === 'train' && isAnnotated(it)).length;
    const valCount = items.filter((it) => it.split === 'val' && isAnnotated(it)).length;
    const testCount = items.filter((it) => it.split === 'test' && isAnnotated(it)).length;

    if (activeDataset.classes.length === 0 || trainCount < 2) {
      return {
        ready: false,
        reason: t.trainingStudio.datasetGateNeedAnnotated,
        trainCount,
        valCount,
        testCount,
      };
    }
    if (project.taskType === 'image_classification' && activeDataset.classes.length < 2) {
      return {
        ready: false,
        reason: t.trainingStudio.datasetGateNeedAnnotated,
        trainCount,
        valCount,
        testCount,
      };
    }

    return {
      ready: true,
      reason: t.trainingStudio.datasetGateReady,
      trainCount,
      valCount,
      testCount,
    };
  }, [activeDataset, items, project.taskType, t]);

  // Live training state & control refs
  const [isTraining, setIsTraining] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pythonJobId, setPythonJobId] = useState<string | null>(null);
  const [liveEpochs, setLiveEpochs] = useState<EpochMetricPoint[]>([]);
  const [liveBestEpoch, setLiveBestEpoch] = useState(0);
  const [liveBestMetric, setLiveBestMetric] = useState(0);
  const [liveHardware, setLiveHardware] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);

  const pauseRef = useRef(false);
  const cancelRef = useRef(false);

  const appendLog = (line: string) => {
    const stamp = new Date().toLocaleTimeString([], { hour12: false });
    setLogs((prev) => [...prev.slice(-120), `[${stamp}] ${line}`]);
  };

  const handleStartTraining = async () => {
    if (!activeDataset || !readiness.ready || !selectedArch) return;

    setTrainError(null);
    setLiveEpochs([]);
    setLiveBestEpoch(0);
    setLiveBestMetric(0);
    setLogs([]);
    pauseRef.current = false;
    cancelRef.current = false;
    setIsPaused(false);
    setIsTraining(true);

    const runId = makeClientId('run');
    const modelId = makeClientId('mdl');
    setActiveRunId(runId);
    setPythonJobId(null);

    try {
      if (selectedArch.backendEngine === 'python_fastapi') {
        setLiveHardware('Python FastAPI Worker');
        await createTrainingRun({
          runId,
          ownerUid: project.ownerUid,
          projectId: project.id,
          datasetId: activeDataset.id,
          datasetVersion: activeDataset.version,
          taskType: project.taskType,
          backendEngine: 'python_fastapi',
          architecture: selectedArch.id,
          trainingMode: mode,
          hyperparameters: hp,
          hardwareSummary: 'Python FastAPI Worker',
          currentModelCount: trainedModels.length,
        });

        appendLog(`Dispatching job to Python AI Engine (${selectedArch.name})...`);
        const pyJob = await startPythonTrainingJob({
          projectId: project.id,
          datasetId: activeDataset.id,
          taskType: project.taskType,
          architecture: selectedArch.id,
          classes: activeDataset.classes,
          hyperparameters: hp,
        });
        setPythonJobId(pyJob.job_id);
        appendLog(`Python worker accepted job ${pyJob.job_id}`);

        // Poll Python worker until terminal
        let finished = false;
        while (!finished) {
          await new Promise((r) => setTimeout(r, 1000));
          const polled = await fetchPythonTrainingJob(pyJob.job_id);
          setLiveEpochs(polled.epochMetrics || []);
          setLiveBestEpoch(polled.bestEpoch || 0);
          setLiveBestMetric(polled.bestValMetric || 0);
          if (polled.logs?.length) {
            setLogs(polled.logs);
          }

          if (['completed', 'cancelled', 'failed'].includes(polled.status)) {
            finished = true;
            await updateTrainingRunProgress({
              runId,
              status: polled.status as 'completed' | 'cancelled' | 'failed',
              currentEpoch: polled.currentEpoch,
              epochMetrics: polled.epochMetrics,
              bestEpoch: polled.bestEpoch,
              bestValMetric: polled.bestValMetric,
              checkpointSaved: Boolean(polled.checkpointPath),
              hardwareSummary: 'Python FastAPI Worker',
              errorMessage: polled.errorMessage || '',
              completedAt: new Date().toISOString(),
            });
            if (polled.status === 'failed') {
              throw new Error(polled.errorMessage || 'Python worker failed');
            }
          }
        }
        return;
      }

      // In-Browser Real TensorFlow.js Training
      await createTrainingRun({
        runId,
        ownerUid: project.ownerUid,
        projectId: project.id,
        datasetId: activeDataset.id,
        datasetVersion: activeDataset.version,
        taskType: project.taskType,
        backendEngine: 'tfjs_browser',
        architecture: selectedArch.id,
        trainingMode: mode,
        hyperparameters: hp,
        hardwareSummary: 'Browser TensorFlow.js',
        currentModelCount: trainedModels.length,
      });

      const collectedEpochs: EpochMetricPoint[] = [];

      const result = await runBrowserTrainingPipeline({
        runId,
        modelId,
        projectId: project.id,
        taskType: project.taskType,
        architecture: selectedArch.id,
        dataset: activeDataset,
        items,
        hyperparameters: hp,
        hooks: {
          shouldPause: () => pauseRef.current,
          shouldCancel: () => cancelRef.current,
          onLog: (line) => appendLog(line),
          onEpoch: async (pt, bestEp, bestVal) => {
            collectedEpochs.push(pt);
            setLiveEpochs([...collectedEpochs]);
            setLiveBestEpoch(bestEp);
            setLiveBestMetric(bestVal);
            await updateTrainingRunProgress({
              runId,
              status: pauseRef.current ? 'paused' : 'running',
              currentEpoch: pt.epoch,
              epochMetrics: collectedEpochs,
              bestEpoch: bestEp,
              bestValMetric: bestVal,
              checkpointSaved: hp.saveCheckpoints,
              hardwareSummary: 'Browser TensorFlow.js',
            });
          },
        },
      });

      setLiveHardware(result.hardwareSummary);

      if (result.status === 'cancelled') {
        await updateTrainingRunProgress({
          runId,
          status: 'cancelled',
          currentEpoch: result.epochMetrics.length,
          epochMetrics: result.epochMetrics,
          bestEpoch: result.bestEpoch,
          bestValMetric: result.bestValMetric,
          checkpointSaved: hp.saveCheckpoints && result.epochMetrics.length > 0,
          hardwareSummary: result.hardwareSummary,
          completedAt: new Date().toISOString(),
        });
        await logActivity({
          ownerUid: project.ownerUid,
          projectId: project.id,
          action: 'training_cancelled',
          targetType: 'training_run',
          targetName: selectedArch.name,
        });
        appendLog('Training run cancelled.');
      } else {
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

        const modelName = `${selectedArch.name} · v${trainedModels.length + 1}`;
        await saveTrainedModelRecord({
          modelId,
          runId,
          projectId: project.id,
          datasetId: activeDataset.id,
          datasetVersion: activeDataset.version,
          ownerUid: project.ownerUid,
          name: modelName,
          taskType: project.taskType,
          backendEngine: 'tfjs_browser',
          architecture: selectedArch.id,
          license: selectedArch.license,
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
          onDeviceCompatible: selectedArch.onDeviceCompatible,
          newModelCount: trainedModels.length + 1,
        });

        setSelectedModelId(modelId);
        appendLog(
          `Model saved (${formatBytes(result.weightSizeBytes)}, ${result.inferenceLatencyMs}ms/img on ${result.evaluatedSplit} split).`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Training failed';
      setTrainError(msg);
      appendLog(`Error: ${msg}`);
      await updateTrainingRunProgress({
        runId,
        status: 'failed',
        currentEpoch: liveEpochs.length,
        epochMetrics: liveEpochs,
        bestEpoch: liveBestEpoch,
        bestValMetric: liveBestMetric,
        checkpointSaved: false,
        hardwareSummary: liveHardware || selectedArch.backendEngine,
        errorMessage: msg,
        completedAt: new Date().toISOString(),
      }).catch(() => {});
    } finally {
      setIsTraining(false);
      setIsPaused(false);
      setActiveRunId(null);
      setPythonJobId(null);
    }
  };

  const handlePauseResume = async () => {
    const nextPaused = !isPaused;
    pauseRef.current = nextPaused;
    setIsPaused(nextPaused);
    if (pythonJobId) {
      await controlPythonTrainingJob(pythonJobId, nextPaused ? 'pause' : 'resume').catch(() => {});
    } else if (activeRunId) {
      await updateTrainingRunStatus({
        runId: activeRunId,
        status: nextPaused ? 'paused' : 'running',
      }).catch(() => {});
    }
    appendLog(nextPaused ? 'Training paused.' : 'Training resumed.');
  };

  const handleCancelTraining = async () => {
    cancelRef.current = true;
    pauseRef.current = false;
    setIsPaused(false);
    if (pythonJobId) {
      await controlPythonTrainingJob(pythonJobId, 'cancel').catch(() => {});
    }
    appendLog('Cancelling training after current step...');
  };

  // Selected Trained Model Inspection & Real Test Inference
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const inspectedModel =
    trainedModels.find((m) => m.id === selectedModelId) ||
    trainedModels.find((m) => m.isActive) ||
    trainedModels[0] ||
    null;

  const [testImageUrl, setTestImageUrl] = useState<string | null>(null);
  const [testPrediction, setTestPrediction] = useState<InferencePrediction | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testErr, setTestErr] = useState<string | null>(null);
  const testFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (testImageUrl) URL.revokeObjectURL(testImageUrl);
    };
  }, [testImageUrl]);

  const handleTestImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !inspectedModel) return;

    if (testImageUrl) URL.revokeObjectURL(testImageUrl);
    const url = URL.createObjectURL(file);
    setTestImageUrl(url);
    setTestPrediction(null);
    setTestErr(null);
    setTestBusy(true);

    try {
      const loaded = await loadTfModelFromIndexedDb(inspectedModel.id);
      if (!loaded) {
        throw new Error('Model weights not found in local IndexedDB on this browser.');
      }
      try {
        const pred = await predictImageWithLocalModel({
          model: loaded.model,
          taskType: inspectedModel.taskType,
          classes: inspectedModel.classes,
          inputSize: inspectedModel.inputSize,
          imageBlob: file,
          confidenceThreshold: 0.25,
          iouThreshold: 0.5,
        });
        setTestPrediction(pred);
      } finally {
        loaded.model.dispose();
      }
    } catch (err) {
      setTestErr(err instanceof Error ? err.message : 'Inference failed');
    } finally {
      setTestBusy(false);
    }
  };

  const handleExportWeights = async (model: TrainedModel) => {
    const exported = await exportStoredModelArtifacts(model.id);
    if (!exported) {
      setTestErr('Local model artifacts not found in IndexedDB.');
      return;
    }
    const triggerDownload = (blob: Blob, filename: string) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    triggerDownload(
      new Blob([exported.manifestJson], { type: 'application/json' }),
      `${exported.filenameBase}.model.json`
    );
    triggerDownload(exported.weightsBlob, `${model.id}.weights.bin`);
  };

  const statusLabel = (st: TrainingRun['status']) => {
    switch (st) {
      case 'queued':
        return t.trainingStudio.statusQueued;
      case 'running':
        return t.trainingStudio.statusRunning;
      case 'paused':
        return t.trainingStudio.statusPaused;
      case 'completed':
        return t.trainingStudio.statusCompleted;
      case 'cancelled':
        return t.trainingStudio.statusCancelled;
      default:
        return t.trainingStudio.statusFailed;
    }
  };

  return (
    <div className="space-y-6">
      {/* Training Config & Control Panel */}
      <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {t.trainingStudio.heading}
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
              {t.trainingStudio.subheading}
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shrink-0">
            {(['beginner', 'advanced'] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={isTraining}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === m
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                {m === 'beginner' ? t.projectModal.beginnerMode : t.projectModal.advancedMode}
              </button>
            ))}
          </div>
        </div>

        {/* Dataset Readiness Banner */}
        <div
          className={`rounded-lg border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
            readiness.ready
              ? 'border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/15'
              : 'border-amber-300 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/15'
          }`}
        >
          <div className="space-y-0.5">
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">
              {t.trainingStudio.datasetGateTitle}
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">{readiness.reason}</p>
          </div>
          {activeDataset && (
            <div className="font-mono tabular-nums text-[11px] text-zinc-700 dark:text-zinc-300 shrink-0">
              Train {readiness.trainCount} · Val {readiness.valCount} · Test {readiness.testCount}
            </div>
          )}
        </div>

        {/* Dataset & Architecture Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.trainingStudio.datasetLabel}
            </label>
            <select
              disabled={isTraining || datasets.length === 0}
              value={activeDataset?.id || ''}
              onChange={(e) => onSelectDataset(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              {datasets.length === 0 ? (
                <option value="">{t.trainingStudio.datasetGateEmpty}</option>
              ) : (
                datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name} (v{ds.version} · {ds.classes.length} classes)
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.trainingStudio.architectureLabel}
            </label>
            <select
              disabled={isTraining}
              value={selectedArchId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedArchId(nextId);
                const arch = taskArchitectures.find((a) => a.id === nextId);
                if (arch) {
                  setHp((prev) => ({ ...prev, inputSize: arch.recommendedInputSize }));
                }
              }}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              {taskArchitectures.map((arch) => (
                <option key={arch.id} value={arch.id}>
                  {arch.name} — {arch.license}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected Architecture Details & Runtime Status */}
        {selectedArch && (
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-zinc-50 dark:bg-zinc-950 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {selectedArch.backendEngine === 'tfjs_browser'
                  ? t.trainingStudio.browserEngineBadge
                  : t.trainingStudio.pythonEngineBadge}
              </span>
              {selectedArch.backendEngine === 'python_fastapi' && (
                <button
                  type="button"
                  disabled={probingEngine}
                  onClick={handleProbeEngine}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900"
                >
                  <RefreshCw className={`w-3 h-3 ${probingEngine ? 'animate-spin' : ''}`} />
                  <span>{t.projectWorkspace.engineProbeBtn}</span>
                </button>
              )}
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {locale === 'ar' ? selectedArch.summaryAr : selectedArch.summaryEn}
            </p>
            {selectedArch.backendEngine === 'python_fastapi' &&
              (!engineStatus || !engineStatus.reachable) && (
                <p className="text-amber-700 dark:text-amber-400">
                  {t.trainingStudio.pythonOfflineHint}
                </p>
              )}
          </div>
        )}

        {/* Beginner vs Advanced Hyperparameters */}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {mode === 'beginner' ? t.trainingStudio.modeBeginnerDesc : t.trainingStudio.modeAdvancedDesc}
        </p>

        {mode === 'beginner' ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 tabular-nums">
            <div>
              <span className="text-zinc-500 block">{t.trainingStudio.epochsLabel}</span>
              <span className="font-mono font-semibold">{hp.epochs}</span>
            </div>
            <div>
              <span className="text-zinc-500 block">{t.trainingStudio.batchSizeLabel}</span>
              <span className="font-mono font-semibold">{hp.batchSize}</span>
            </div>
            <div>
              <span className="text-zinc-500 block">{t.trainingStudio.learningRateLabel}</span>
              <span className="font-mono font-semibold">{hp.learningRate}</span>
            </div>
            <div>
              <span className="text-zinc-500 block">{t.trainingStudio.optimizerLabel}</span>
              <span className="font-mono font-semibold uppercase">{hp.optimizer}</span>
            </div>
            <div>
              <span className="text-zinc-500 block">{t.trainingStudio.inputSizeLabel}</span>
              <span className="font-mono font-semibold">{hp.inputSize}px</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.epochsLabel}
              </label>
              <input
                type="number"
                min={1}
                max={200}
                disabled={isTraining}
                value={hp.epochs}
                onChange={(e) => setHp({ ...hp, epochs: Number(e.target.value) || 1 })}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.batchSizeLabel}
              </label>
              <select
                disabled={isTraining}
                value={hp.batchSize}
                onChange={(e) => setHp({ ...hp, batchSize: Number(e.target.value) })}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono tabular-nums"
              >
                {[1, 2, 4, 8, 16, 32].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.learningRateLabel}
              </label>
              <input
                type="number"
                step={0.0001}
                min={0.00005}
                max={0.1}
                disabled={isTraining}
                value={hp.learningRate}
                onChange={(e) => setHp({ ...hp, learningRate: Number(e.target.value) || 0.001 })}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.optimizerLabel}
              </label>
              <select
                disabled={isTraining}
                value={hp.optimizer}
                onChange={(e) =>
                  setHp({ ...hp, optimizer: e.target.value as TrainingHyperparameters['optimizer'] })
                }
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 uppercase"
              >
                <option value="adam">Adam</option>
                <option value="sgd">SGD</option>
                <option value="rmsprop">RMSprop</option>
              </select>
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.inputSizeLabel}
              </label>
              <select
                disabled={isTraining}
                value={hp.inputSize}
                onChange={(e) => setHp({ ...hp, inputSize: Number(e.target.value) })}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono tabular-nums"
              >
                {[64, 96, 128, 160, 224].map((sz) => (
                  <option key={sz} value={sz}>
                    {sz}×{sz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.confThresholdLabel}
              </label>
              <input
                type="number"
                step={0.05}
                min={0.05}
                max={0.95}
                disabled={isTraining}
                value={hp.confidenceThreshold}
                onChange={(e) => setHp({ ...hp, confidenceThreshold: Number(e.target.value) || 0.35 })}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.iouThresholdLabel}
              </label>
              <input
                type="number"
                step={0.05}
                min={0.1}
                max={0.95}
                disabled={isTraining}
                value={hp.iouThreshold}
                onChange={(e) => setHp({ ...hp, iouThreshold: Number(e.target.value) || 0.5 })}
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-zinc-600 dark:text-zinc-400 mb-1">
                {t.trainingStudio.patienceLabel}
              </label>
              <input
                type="number"
                min={0}
                max={50}
                disabled={isTraining}
                value={hp.earlyStoppingPatience}
                onChange={(e) =>
                  setHp({ ...hp, earlyStoppingPatience: Number(e.target.value) || 0 })
                }
                className="w-full px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono tabular-nums"
              />
            </div>
            <label className="col-span-2 sm:col-span-4 flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                disabled={isTraining}
                checked={hp.saveCheckpoints}
                onChange={(e) => setHp({ ...hp, saveCheckpoints: e.target.checked })}
                className="accent-red-600"
              />
              <span>{t.trainingStudio.saveCheckpointsLabel}</span>
            </label>
          </div>
        )}

        {trainError && (
          <div className="p-3 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-400">
            {trainError}
          </div>
        )}

        {/* Action Bar */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {!isTraining ? (
            <button
              type="button"
              disabled={!readiness.ready}
              onClick={handleStartTraining}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              <span>{t.trainingStudio.startTrainingBtn}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handlePauseResume}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                <span>{isPaused ? t.trainingStudio.resumeBtn : t.trainingStudio.pauseBtn}</span>
              </button>
              <button
                type="button"
                onClick={handleCancelTraining}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                <Square className="w-3.5 h-3.5" />
                <span>{t.trainingStudio.cancelBtn}</span>
              </button>
            </>
          )}
        </div>
      </section>

      {/* Live Progress, Charts & Logs */}
      {(isTraining || liveEpochs.length > 0 || logs.length > 0) && (
        <section className="space-y-4">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                <Activity className="w-4 h-4 text-red-600" />
                <span>{t.trainingStudio.liveProgressTitle}</span>
              </div>
              <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                <span>
                  {t.trainingStudio.epochLabel}: {liveEpochs.length}/{hp.epochs}
                </span>
                <span>
                  {t.trainingStudio.bestEpochLabel}: {liveBestEpoch || '—'} (
                  {(liveBestMetric * 100).toFixed(1)}%)
                </span>
                {liveHardware && (
                  <span>
                    {t.trainingStudio.hardwareLabel}: {liveHardware}
                  </span>
                )}
              </div>
            </div>

            <div className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-red-600 transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.round((liveEpochs.length / Math.max(1, hp.epochs)) * 100))}%`,
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EpochLineChart
              title={t.trainingStudio.lossChartTitle}
              points={liveEpochs}
              primaryKey="trainLoss"
              secondaryKey="valLoss"
              primaryLabel="Train Loss"
              secondaryLabel="Val Loss"
            />
            <EpochLineChart
              title={t.trainingStudio.metricChartTitle}
              points={liveEpochs}
              primaryKey="trainMetric"
              secondaryKey="valMetric"
              primaryLabel={project.taskType === 'image_classification' ? 'Train Acc' : 'Val F1'}
              secondaryLabel={project.taskType === 'image_classification' ? 'Val Acc' : 'Val mAP@50'}
              isPercent
            />
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-zinc-950 text-zinc-200 space-y-2">
            <p className="text-xs font-semibold text-zinc-400">{t.trainingStudio.logsTitle}</p>
            <div className="max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1" dir="ltr">
              {logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Trained Models & Real Evaluation Summary */}
      <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-red-600" />
            <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {t.trainingStudio.trainedModelsTitle}
            </h3>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-500">
            {trainedModels.length}
          </span>
        </div>

        {trainedModels.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 py-4">
            {t.trainingStudio.trainedModelsEmpty}
          </p>
        ) : (
          <div className="space-y-5">
            {/* Model selector strip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {trainedModels.map((model) => {
                const selected = inspectedModel?.id === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModelId(model.id)}
                    className={`text-start p-4 rounded-xl border transition-colors space-y-2 ${
                      selected
                        ? 'border-red-600 bg-red-50/30 dark:bg-red-950/15'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {model.name}
                      </span>
                      {model.isActive && (
                        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t.trainingStudio.activeModelLabel}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                      {model.taskType === 'image_classification'
                        ? `${t.trainingStudio.accuracyLabel}: ${(model.accuracy * 100).toFixed(1)}%`
                        : `${t.trainingStudio.map50Label}: ${(model.mAP50 * 100).toFixed(1)}%`}{' '}
                      · F1 {(model.f1Score * 100).toFixed(1)}% · {formatBytes(model.weightSizeBytes)} ·{' '}
                      {model.inferenceLatencyMs}ms
                    </div>
                  </button>
                );
              })}
            </div>

            {inspectedModel && (
              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 space-y-5">
                {/* Actions & Specs */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {inspectedModel.architecture} · {inspectedModel.license} ·{' '}
                    {inspectedModel.inputSize}×{inspectedModel.inputSize}px ·{' '}
                    {inspectedModel.parameterCount.toLocaleString()} {t.trainingStudio.paramsLabel}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!inspectedModel.isActive && (
                      <button
                        type="button"
                        onClick={() => setActiveTrainedModel(trainedModels, inspectedModel.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {t.trainingStudio.setActiveBtn}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleExportWeights(inspectedModel)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t.trainingStudio.exportWeightsBtn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        deleteTrainedModel(
                          inspectedModel.id,
                          project.id,
                          Math.max(0, trainedModels.length - 1)
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 dark:border-red-900/60 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t.trainingStudio.deleteModelBtn}</span>
                    </button>
                  </div>
                </div>

                {/* Metric Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 tabular-nums text-xs">
                  <div>
                    <span className="text-zinc-500 block">
                      {inspectedModel.taskType === 'image_classification'
                        ? t.trainingStudio.accuracyLabel
                        : t.trainingStudio.map50Label}
                    </span>
                    <span className="text-lg font-display font-bold text-red-600">
                      {(
                        (inspectedModel.taskType === 'image_classification'
                          ? inspectedModel.accuracy
                          : inspectedModel.mAP50) * 100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">{t.trainingStudio.precisionLabel}</span>
                    <span className="text-lg font-display font-bold">
                      {(inspectedModel.precision * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">{t.trainingStudio.recallLabel}</span>
                    <span className="text-lg font-display font-bold">
                      {(inspectedModel.recall * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">{t.trainingStudio.f1Label}</span>
                    <span className="text-lg font-display font-bold">
                      {(inspectedModel.f1Score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">{t.trainingStudio.latencyLabel}</span>
                    <span className="text-lg font-display font-bold">
                      {inspectedModel.inferenceLatencyMs}ms
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">{t.trainingStudio.modelSizeLabel}</span>
                    <span className="text-lg font-display font-bold">
                      {formatBytes(inspectedModel.weightSizeBytes)}
                    </span>
                  </div>
                </div>

                {/* Confusion Matrix + Per-Class Table */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-3 overflow-x-auto">
                    <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {t.trainingStudio.confusionTitle}
                    </h4>
                    <table className="w-full text-[11px] font-mono tabular-nums border-collapse">
                      <thead>
                        <tr>
                          <th className="p-1.5 text-start text-zinc-400">T \ P</th>
                          {inspectedModel.confusionLabels.map((lbl) => (
                            <th key={lbl} className="p-1.5 text-center truncate max-w-[70px]">
                              {lbl}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {inspectedModel.confusionLabels.map((rowLbl, r) => {
                          const n = inspectedModel.confusionLabels.length;
                          return (
                            <tr key={rowLbl} className="border-t border-zinc-100 dark:border-zinc-800">
                              <td className="p-1.5 font-semibold truncate max-w-[80px]">{rowLbl}</td>
                              {inspectedModel.confusionLabels.map((_, c) => {
                                const val = inspectedModel.confusionFlat[r * n + c] ?? 0;
                                const isDiag = r === c;
                                return (
                                  <td
                                    key={c}
                                    className={`p-1.5 text-center ${
                                      isDiag && val > 0
                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 font-bold text-emerald-700 dark:text-emerald-400'
                                        : val > 0
                                        ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                                        : 'text-zinc-400'
                                    }`}
                                  >
                                    {val}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-3 overflow-x-auto">
                    <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {t.trainingStudio.perClassTitle}
                    </h4>
                    <table className="w-full text-xs tabular-nums">
                      <thead>
                        <tr className="text-[11px] text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                          <th className="py-1.5 text-start">Class</th>
                          <th className="py-1.5 text-end">P</th>
                          <th className="py-1.5 text-end">R</th>
                          <th className="py-1.5 text-end">F1</th>
                          <th className="py-1.5 text-end">Support</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {inspectedModel.perClassMetrics.map((row) => (
                          <tr key={row.className}>
                            <td className="py-2 font-medium">{row.className}</td>
                            <td className="py-2 text-end font-mono">
                              {(row.precision * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 text-end font-mono">
                              {(row.recall * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 text-end font-mono">
                              {(row.f1Score * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 text-end font-mono text-zinc-500">{row.support}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Real Quick Inference Test */}
                {inspectedModel.backendEngine === 'tfjs_browser' && (
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-zinc-50 dark:bg-zinc-950 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {t.trainingStudio.quickTestTitle}
                        </h4>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {t.trainingStudio.quickTestDesc}
                        </p>
                      </div>
                      <input
                        ref={testFileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleTestImageSelected}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={testBusy}
                        onClick={() => testFileInputRef.current?.click()}
                        className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{t.trainingStudio.uploadTestImageBtn}</span>
                      </button>
                    </div>

                    {testErr && (
                      <p className="text-xs text-red-600 dark:text-red-400">{testErr}</p>
                    )}

                    {testImageUrl && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black flex items-center justify-center max-h-64">
                          <img
                            src={testImageUrl}
                            alt="Inference test sample"
                            className="max-h-64 w-auto object-contain"
                          />
                          {testPrediction?.detections.map((d, idx) => (
                            <div
                              key={idx}
                              style={{
                                left: `${d.x * 100}%`,
                                top: `${d.y * 100}%`,
                                width: `${d.width * 100}%`,
                                height: `${d.height * 100}%`,
                              }}
                              className="absolute border-2 border-red-500 pointer-events-none"
                            >
                              <span className="bg-red-600 text-white text-[10px] px-1 py-0.5 font-mono">
                                {d.className} {(d.confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-2 text-xs">
                          {testPrediction && (
                            <>
                              <p className="font-mono text-zinc-500 tabular-nums">
                                {t.trainingStudio.latencyLabel}: {testPrediction.latencyMs}ms
                              </p>
                              {testPrediction.classifications.map((c) => (
                                <div key={c.className} className="space-y-1">
                                  <div className="flex justify-between font-mono tabular-nums">
                                    <span>{c.className}</span>
                                    <span>{(c.confidence * 100).toFixed(1)}%</span>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800">
                                    <div
                                      className="h-full bg-red-600 rounded-full"
                                      style={{ width: `${Math.round(c.confidence * 100)}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                              {testPrediction.taskType === 'object_detection' &&
                                testPrediction.detections.length === 0 && (
                                  <p className="text-zinc-500">
                                    0 detections above confidence threshold (0.25).
                                  </p>
                                )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Recent Runs History */}
      {trainingRuns.length > 0 && (
        <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-3 overflow-x-auto">
          <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.trainingStudio.recentRunsTitle}
          </h3>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[11px] text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 text-start">Architecture</th>
                <th className="py-2 text-start">Status</th>
                <th className="py-2 text-end">Epochs</th>
                <th className="py-2 text-end">Best Metric</th>
                <th className="py-2 text-start ps-4">Hardware</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {trainingRuns.map((run) => (
                <tr key={run.id}>
                  <td className="py-2 font-medium">{run.architecture}</td>
                  <td className="py-2">{statusLabel(run.status)}</td>
                  <td className="py-2 text-end font-mono">
                    {run.currentEpoch}/{run.totalEpochs}
                  </td>
                  <td className="py-2 text-end font-mono">
                    {(run.bestValMetric * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 ps-4 text-zinc-500">{run.hardwareSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
