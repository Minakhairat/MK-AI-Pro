import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Camera,
  CheckCircle2,
  Cpu,
  ImagePlus,
  Play,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { getMediaBlob } from '../../lib/localMediaStore';
import { listStoredModelKeys, loadTfModelFromIndexedDb } from '../../lib/localModelStore';
import {
  getModelCatalogEntry,
  getPreprocessModeForArchitecture,
} from '../../lib/modelRegistry';
import { evaluateLocalModelOnItems, predictImageWithLocalModel } from '../../lib/tfTrainer';
import {
  deleteEvaluationReport,
  saveEvaluationReport,
} from '../../services/firestoreService';
import type {
  BatchEvalSampleResult,
  BatchEvaluationResult,
  Dataset,
  DatasetItem,
  EvaluationReport,
  EvaluationSplitTarget,
  InferencePrediction,
  Project,
  TrainedModel,
} from '../../types/domain';

interface EvaluationStudioProps {
  project: Project;
  datasets: Dataset[];
  activeDataset: Dataset | null;
  items: DatasetItem[];
  trainedModels: TrainedModel[];
  evaluationReports: EvaluationReport[];
  onOpenTraining: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    const fn = (ts as { toDate?: () => Date }).toDate;
    if (typeof fn === 'function') {
      return fn.call(ts).toLocaleString();
    }
  }
  return '—';
}

function SampleThumbnail({ itemId, alt }: { itemId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    getMediaBlob(itemId)
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId]);

  if (!url) {
    return (
      <div className="w-full h-36 bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center text-xs text-zinc-400">
        —
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      referrerPolicy="no-referrer"
      className="w-full h-36 object-contain bg-zinc-950/90"
    />
  );
}

export function EvaluationStudio({
  project,
  datasets,
  activeDataset,
  items,
  trainedModels,
  evaluationReports,
  onOpenTraining,
}: EvaluationStudioProps) {
  const { t, locale } = useI18n();
  const ev = t.evaluationStudio;
  const ts = t.trainingStudio;

  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [localWeightKeys, setLocalWeightKeys] = useState<Set<string>>(new Set());
  const [splitTarget, setSplitTarget] = useState<EvaluationSplitTarget>('test');
  const [confThreshold, setConfThreshold] = useState<number>(0.35);
  const [iouThreshold, setIouThreshold] = useState<number>(0.5);

  const [runningBatch, setRunningBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchEvaluationResult | null>(null);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);

  // Sample inspection filters
  const [sampleFilter, setSampleFilter] = useState<'all' | 'errors' | 'correct'>('all');
  const [cellFilter, setCellFilter] = useState<{ actual: string; predicted: string } | null>(
    null
  );
  const [inspectedSample, setInspectedSample] = useState<BatchEvalSampleResult | null>(null);
  const [inspectedSampleUrl, setInspectedSampleUrl] = useState<string | null>(null);

  // Side-by-side comparison selection
  const [compareIds, setCompareIds] = useState<string[]>([]);

  // Live Image & Camera Inference Lab
  const liveFileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [livePred, setLivePred] = useState<InferencePrediction | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [runningLive, setRunningLive] = useState(false);

  useEffect(() => {
    listStoredModelKeys()
      .then((keys) => setLocalWeightKeys(keys))
      .catch(() => {});
  }, [trainedModels.length]);

  useEffect(() => {
    if (trainedModels.length === 0) {
      setSelectedModelId('');
      setCompareIds([]);
      return;
    }
    if (!selectedModelId || !trainedModels.some((m) => m.id === selectedModelId)) {
      const active = trainedModels.find((m) => m.isActive) || trainedModels[0];
      setSelectedModelId(active.id);
    }
    setCompareIds((prev) => {
      const valid = prev.filter((id) => trainedModels.some((m) => m.id === id));
      if (valid.length > 0) return valid;
      return trainedModels.slice(0, Math.min(3, trainedModels.length)).map((m) => m.id);
    });
  }, [trainedModels]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
      if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl);
    };
  }, [livePreviewUrl]);

  useEffect(() => {
    if (!inspectedSample) {
      setInspectedSampleUrl(null);
      return;
    }
    let active = true;
    let url: string | null = null;
    getMediaBlob(inspectedSample.itemId)
      .then((blob) => {
        if (!active || !blob) return;
        url = URL.createObjectURL(blob);
        setInspectedSampleUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [inspectedSample]);

  const selectedModel = useMemo(
    () => trainedModels.find((m) => m.id === selectedModelId) || trainedModels[0] || null,
    [trainedModels, selectedModelId]
  );

  const comparedModels = useMemo(
    () => trainedModels.filter((m) => compareIds.includes(m.id)),
    [trainedModels, compareIds]
  );

  const activeConfusion = useMemo(() => {
    if (batchResult) {
      return {
        labels: batchResult.confusionLabels,
        flat: batchResult.confusionFlat,
        perClass: batchResult.perClassMetrics,
      };
    }
    if (selectedModel) {
      return {
        labels: selectedModel.confusionLabels,
        flat: selectedModel.confusionFlat,
        perClass: selectedModel.perClassMetrics,
      };
    }
    return { labels: [], flat: [], perClass: [] };
  }, [batchResult, selectedModel]);

  const filteredSamples = useMemo(() => {
    if (!batchResult) return [];
    return batchResult.samples.filter((s) => {
      if (sampleFilter === 'errors' && s.correct) return false;
      if (sampleFilter === 'correct' && !s.correct) return false;
      if (cellFilter) {
        if (project.taskType === 'image_classification') {
          return (
            s.groundTruthLabel === cellFilter.actual &&
            s.predictedLabel === cellFilter.predicted
          );
        }
        const gtHas = s.groundTruthBoxes.some((b) => b.className === cellFilter.actual);
        const predHas = s.predictedBoxes.some((b) => b.className === cellFilter.predicted);
        if (cellFilter.actual === '__background__') return !gtHas && predHas;
        if (cellFilter.predicted === '__background__') return gtHas && s.predictedBoxes.length === 0;
        return gtHas || predHas;
      }
      return true;
    });
  }, [batchResult, sampleFilter, cellFilter, project.taskType]);

  const hasLocalWeights = selectedModel ? localWeightKeys.has(selectedModel.id) : false;

  const handleRunBatchEvaluation = async () => {
    if (!selectedModel) return;
    setBatchError(null);
    setSnapshotNotice(null);
    setCellFilter(null);
    setRunningBatch(true);
    setBatchProgress(null);

    try {
      const loaded = await loadTfModelFromIndexedDb(selectedModel.id);
      if (!loaded) {
        throw new Error(ev.noLocalWeightsError);
      }

      try {
        const res = await evaluateLocalModelOnItems({
          model: loaded.model,
          modelId: selectedModel.id,
          taskType: selectedModel.taskType,
          classes: loaded.record.classes,
          inputSize: loaded.record.inputSize,
          items,
          split: splitTarget,
          confidenceThreshold: confThreshold,
          iouThreshold,
          preprocessMode:
            loaded.record.preprocessMode ??
            getPreprocessModeForArchitecture(selectedModel.architecture),
          onProgress: (done, total) => setBatchProgress({ done, total }),
        });
        setBatchResult(res);
      } finally {
        loaded.model.dispose();
      }
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setRunningBatch(false);
    }
  };

  const handleSaveSnapshot = async () => {
    if (!selectedModel || !batchResult) return;
    setSavingSnapshot(true);
    setSnapshotNotice(null);
    setBatchError(null);
    try {
      const ds =
        datasets.find((d) => d.id === selectedModel.datasetId) || activeDataset;
      await saveEvaluationReport({
        projectId: project.id,
        modelId: selectedModel.id,
        modelName: selectedModel.name,
        datasetId: selectedModel.datasetId,
        datasetVersion: ds?.version ?? selectedModel.datasetVersion,
        ownerUid: project.ownerUid,
        taskType: selectedModel.taskType,
        split: batchResult.split,
        sampleCount: batchResult.sampleCount,
        confidenceThreshold: batchResult.confidenceThreshold,
        iouThreshold: batchResult.iouThreshold,
        accuracy: batchResult.accuracy,
        precision: batchResult.precision,
        recall: batchResult.recall,
        f1Score: batchResult.f1Score,
        mAP50: batchResult.mAP50,
        avgLatencyMs: batchResult.avgLatencyMs,
        p95LatencyMs: batchResult.p95LatencyMs,
        confusionLabels: batchResult.confusionLabels,
        confusionFlat: batchResult.confusionFlat,
        perClassMetrics: batchResult.perClassMetrics,
      });
      setSnapshotNotice(ev.snapshotSavedNotice);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Failed to save snapshot.');
    } finally {
      setSavingSnapshot(false);
    }
  };

  const runLivePredictionOnBlob = async (blob: Blob) => {
    if (!selectedModel) return;
    setLiveError(null);
    setRunningLive(true);
    try {
      const loaded = await loadTfModelFromIndexedDb(selectedModel.id);
      if (!loaded) {
        throw new Error(ev.noLocalWeightsError);
      }
      try {
        if (livePreviewUrl) URL.revokeObjectURL(livePreviewUrl);
        setLivePreviewUrl(URL.createObjectURL(blob));
        const pred = await predictImageWithLocalModel({
          model: loaded.model,
          taskType: selectedModel.taskType,
          classes: loaded.record.classes,
          inputSize: loaded.record.inputSize,
          imageBlob: blob,
          confidenceThreshold: confThreshold,
          iouThreshold,
          preprocessMode:
            loaded.record.preprocessMode ??
            getPreprocessModeForArchitecture(selectedModel.architecture),
        });
        setLivePred(pred);
      } finally {
        loaded.model.dispose();
      }
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Inference failed.');
    } finally {
      setRunningLive(false);
    }
  };

  const handleStartCamera = async () => {
    setLiveError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : 'Camera access unavailable.');
    }
  };

  const handleStopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleCaptureCameraFrame = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth === 0 || vid.videoHeight === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth;
    canvas.height = vid.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          void runLivePredictionOnBlob(blob);
        }
      },
      'image/jpeg',
      0.92
    );
  };

  const toggleCompareModel = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : prev.length >= 4
        ? [...prev.slice(1), id]
        : [...prev, id]
    );
  };

  if (trainedModels.length === 0) {
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 bg-white dark:bg-zinc-900 text-center space-y-4">
        <BarChart3 className="w-8 h-8 text-red-600 mx-auto" />
        <div className="space-y-1.5 max-w-md mx-auto">
          <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {ev.emptyTitle}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{ev.emptyDesc}</p>
        </div>
        <button
          type="button"
          onClick={onOpenTraining}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <Cpu className="w-4 h-4" />
          <span>{ev.goToTrainingBtn}</span>
        </button>
      </div>
    );
  }

  // Compute best values among compared models for clean highlighting
  const bestScore = comparedModels.reduce((max, m) => {
    const val = project.taskType === 'object_detection' ? m.mAP50 : m.accuracy;
    return val > max ? val : max;
  }, 0);
  const bestF1 = comparedModels.reduce((max, m) => (m.f1Score > max ? m.f1Score : max), 0);
  const fastestLatency = comparedModels.reduce(
    (min, m) => (m.inferenceLatencyMs > 0 && m.inferenceLatencyMs < min ? m.inferenceLatencyMs : min),
    Number.POSITIVE_INFINITY
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-2">
        <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
          {ev.heading}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{ev.subheading}</p>
      </div>

      {/* Section 1: Batch Test-Split Evaluation Runner */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {ev.batchRunnerTitle}
            </h3>
            {selectedModel && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {selectedModel.architecture} · {selectedModel.classes.length} classes ·{' '}
                {hasLocalWeights ? t.modelHub.weightsReady : t.modelHub.weightsMissing}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {batchResult && (
              <button
                type="button"
                disabled={savingSnapshot}
                onClick={handleSaveSnapshot}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingSnapshot ? ev.savingSnapshotBtn : ev.saveSnapshotBtn}</span>
              </button>
            )}
            <button
              type="button"
              disabled={runningBatch || !hasLocalWeights || items.length === 0}
              onClick={handleRunBatchEvaluation}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>
                {runningBatch
                  ? `${ev.runningEvalBtn}${
                      batchProgress ? ` (${batchProgress.done}/${batchProgress.total})` : '...'
                    }`
                  : ev.runEvalBtn}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {ev.selectModelLabel}
            </label>
            <select
              value={selectedModelId}
              onChange={(e) => {
                setSelectedModelId(e.target.value);
                setBatchResult(null);
                setCellFilter(null);
              }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            >
              {trainedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.architecture})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {ev.selectSplitLabel}
            </label>
            <select
              value={splitTarget}
              onChange={(e) => setSplitTarget(e.target.value as EvaluationSplitTarget)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
            >
              <option value="test">{ev.splitTest}</option>
              <option value="val">{ev.splitVal}</option>
              <option value="all">{ev.splitAll}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5 tabular-nums">
              {ev.confThresholdLabel}: {confThreshold.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={confThreshold}
              onChange={(e) => setConfThreshold(Number(e.target.value))}
              className="w-full accent-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5 tabular-nums">
              {ev.iouThresholdLabel}: {iouThreshold.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={iouThreshold}
              onChange={(e) => setIouThreshold(Number(e.target.value))}
              className="w-full accent-red-600"
            />
          </div>
        </div>

        {batchError && (
          <p className="text-xs text-red-600 dark:text-red-400">{batchError}</p>
        )}
        {snapshotNotice && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{snapshotNotice}</p>
        )}

        {/* Active Metrics Strip */}
        {(batchResult || selectedModel) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">
                {project.taskType === 'object_detection' ? ts.map50Label : ts.accuracyLabel}
              </p>
              <p className="text-base font-mono font-semibold text-red-600 dark:text-red-500 tabular-nums mt-0.5">
                {Math.round(
                  (batchResult
                    ? project.taskType === 'object_detection'
                      ? batchResult.mAP50
                      : batchResult.accuracy
                    : project.taskType === 'object_detection'
                    ? selectedModel!.mAP50
                    : selectedModel!.accuracy) * 100
                )}
                %
              </p>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">
                {project.taskType === 'object_detection' ? ts.map5095Label : ts.errorRateLabel}
              </p>
              <p className="text-base font-mono font-semibold tabular-nums mt-0.5">
                {project.taskType === 'object_detection'
                  ? batchResult?.mAP50_95 !== undefined
                    ? `${Math.round(batchResult.mAP50_95 * 100)}%`
                    : '—'
                  : `${Math.round(
                      (batchResult?.errorRate ?? Math.max(0, 1 - selectedModel!.accuracy)) * 100
                    )}%`}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">{ts.precisionLabel}</p>
              <p className="text-base font-mono font-semibold tabular-nums mt-0.5">
                {Math.round((batchResult?.precision ?? selectedModel!.precision) * 100)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">{ts.recallLabel}</p>
              <p className="text-base font-mono font-semibold tabular-nums mt-0.5">
                {Math.round((batchResult?.recall ?? selectedModel!.recall) * 100)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">{ts.f1Label}</p>
              <p className="text-base font-mono font-semibold tabular-nums mt-0.5">
                {Math.round((batchResult?.f1Score ?? selectedModel!.f1Score) * 100)}%
              </p>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">{ev.avgLatencyLabel}</p>
              <p className="text-base font-mono font-semibold tabular-nums mt-0.5">
                {batchResult?.avgLatencyMs ?? selectedModel!.inferenceLatencyMs} ms
              </p>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">
                {project.taskType === 'object_detection' ? ts.meanIoULabel : ev.p95LatencyLabel}
              </p>
              <p className="text-base font-mono font-semibold tabular-nums mt-0.5">
                {project.taskType === 'object_detection'
                  ? batchResult?.meanIoU !== undefined
                    ? `${Math.round(batchResult.meanIoU * 100)}%`
                    : '—'
                  : batchResult
                  ? `${batchResult.p95LatencyMs} ms`
                  : '—'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
              <p className="text-[11px] text-zinc-500">{ev.evaluatedCountLabel}</p>
              <p className="text-base font-mono font-semibold tabular-nums mt-0.5">
                {batchResult ? batchResult.sampleCount : '—'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Interactive Confusion Matrix & Per-Class Breakdown */}
      {activeConfusion.labels.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3 overflow-x-auto">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
                  {ts.confusionTitle}
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {ev.confusionHint}
                </p>
              </div>
              {cellFilter && (
                <button
                  type="button"
                  onClick={() => setCellFilter(null)}
                  className="text-xs font-medium text-red-600 hover:underline whitespace-nowrap shrink-0"
                >
                  {ev.clearCellFilter}
                </button>
              )}
            </div>

            {(() => {
              const n = activeConfusion.labels.length;
              const maxVal = Math.max(1, ...activeConfusion.flat);
              return (
                <table className="w-full text-xs border-collapse tabular-nums">
                  <thead>
                    <tr>
                      <th className="p-2 text-start text-zinc-400 font-normal">
                        {locale === 'ar' ? 'حقيقي \\ متوقع' : 'Actual \\ Pred'}
                      </th>
                      {activeConfusion.labels.map((lbl) => (
                        <th key={lbl} className="p-2 text-center font-medium truncate max-w-[90px]">
                          {lbl === '__background__' ? 'BG' : lbl}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeConfusion.labels.map((rowLbl, r) => (
                      <tr key={rowLbl} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="p-2 font-medium truncate max-w-[90px]">
                          {rowLbl === '__background__' ? 'BG' : rowLbl}
                        </td>
                        {activeConfusion.labels.map((colLbl, c) => {
                          const count = activeConfusion.flat[r * n + c] ?? 0;
                          const isDiag = r === c;
                          const isSelected =
                            cellFilter?.actual === rowLbl && cellFilter?.predicted === colLbl;
                          const intensity = count > 0 ? Math.min(0.45, 0.08 + (count / maxVal) * 0.37) : 0;
                          return (
                            <td
                              key={`${rowLbl}-${colLbl}`}
                              onClick={() => {
                                if (batchResult && count > 0) {
                                  setCellFilter({ actual: rowLbl, predicted: colLbl });
                                }
                              }}
                              style={{
                                backgroundColor:
                                  count > 0
                                    ? isDiag
                                      ? `rgba(22, 163, 74, ${intensity})`
                                      : `rgba(220, 38, 38, ${intensity})`
                                    : undefined,
                              }}
                              className={`p-2 text-center font-mono ${
                                batchResult && count > 0 ? 'cursor-pointer hover:opacity-85' : ''
                              } ${isSelected ? 'ring-2 ring-red-600' : ''}`}
                            >
                              {count}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3 overflow-x-auto">
            <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {ts.perClassTitle}
            </h3>
            <table className="w-full text-xs border-collapse tabular-nums">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                  <th className="py-2 text-start font-medium">Class</th>
                  <th className="py-2 text-end font-medium">{ts.precisionLabel}</th>
                  <th className="py-2 text-end font-medium">{ts.recallLabel}</th>
                  <th className="py-2 text-end font-medium">{ts.f1Label}</th>
                  <th className="py-2 text-end font-medium">Support</th>
                </tr>
              </thead>
              <tbody>
                {activeConfusion.perClass.map((row) => (
                  <tr key={row.className} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2 font-medium">{row.className}</td>
                    <td className="py-2 text-end font-mono">{Math.round(row.precision * 100)}%</td>
                    <td className="py-2 text-end font-mono">{Math.round(row.recall * 100)}%</td>
                    <td className="py-2 text-end font-mono">{Math.round(row.f1Score * 100)}%</td>
                    <td className="py-2 text-end font-mono">{row.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 3: Sample-by-Sample Prediction Inspector (after running batch eval) */}
      {batchResult && (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                {ev.sampleInspectorTitle}
              </h3>
              {cellFilter && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  {ev.groundTruthLabel}: {cellFilter.actual} · {ev.predictedLabel}: {cellFilter.predicted}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800">
              {(['all', 'errors', 'correct'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSampleFilter(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    sampleFilter === mode
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {mode === 'all'
                    ? `${ev.filterAll} (${batchResult.samples.length})`
                    : mode === 'errors'
                    ? `${ev.filterErrors} (${batchResult.samples.filter((s) => !s.correct).length})`
                    : `${ev.filterCorrect} (${batchResult.samples.filter((s) => s.correct).length})`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredSamples.slice(0, 24).map((sample) => (
              <button
                key={sample.itemId}
                type="button"
                onClick={() => setInspectedSample(sample)}
                className="text-start border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-zinc-50 dark:bg-zinc-950 hover:border-red-600/60 transition-colors"
              >
                <SampleThumbnail itemId={sample.itemId} alt={sample.filename} />
                <div className="p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{sample.filename}</span>
                    <span
                      className={`font-mono text-[11px] shrink-0 ${
                        sample.correct
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {sample.correct ? 'OK' : 'ERR'} · {sample.latencyMs}ms
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {ev.groundTruthLabel}: <span className="text-zinc-800 dark:text-zinc-200">{sample.groundTruthLabel || '—'}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {ev.predictedLabel}:{' '}
                    <span className="text-zinc-800 dark:text-zinc-200">
                      {sample.predictedLabel || '—'} ({Math.round(sample.confidence * 100)}%)
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sample Lightbox Detail Modal */}
      {inspectedSample && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-sm font-display font-semibold truncate">
                  {inspectedSample.filename}
                </h4>
                <p className="text-xs text-zinc-500 tabular-nums">
                  {inspectedSample.split} · {inspectedSample.latencyMs} ms
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedSample(null)}
                className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {inspectedSampleUrl && (
              <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 flex justify-center">
                <div className="relative inline-block">
                  <img
                    src={inspectedSampleUrl}
                    alt={inspectedSample.filename}
                    referrerPolicy="no-referrer"
                    className="max-h-80 object-contain"
                  />
                  {inspectedSample.groundTruthBoxes.map((b) => (
                    <div
                      key={b.id}
                      style={{
                        left: `${b.x * 100}%`,
                        top: `${b.y * 100}%`,
                        width: `${b.width * 100}%`,
                        height: `${b.height * 100}%`,
                      }}
                      className="absolute border-2 border-emerald-500 pointer-events-none"
                    >
                      <span className="bg-emerald-600 text-white text-[10px] px-1">
                        GT: {b.className}
                      </span>
                    </div>
                  ))}
                  {inspectedSample.predictedBoxes.map((b, idx) => (
                    <div
                      key={idx}
                      style={{
                        left: `${b.x * 100}%`,
                        top: `${b.y * 100}%`,
                        width: `${b.width * 100}%`,
                        height: `${b.height * 100}%`,
                      }}
                      className="absolute border-2 border-red-600 pointer-events-none"
                    >
                      <span className="bg-red-600 text-white text-[10px] px-1">
                        {b.className} {Math.round(b.confidence * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <p className="text-zinc-500">{ev.groundTruthLabel}</p>
                <p className="font-semibold mt-1">{inspectedSample.groundTruthLabel || '—'}</p>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <p className="text-zinc-500">{ev.predictedLabel}</p>
                <p className="font-semibold mt-1">
                  {inspectedSample.predictedLabel || '—'} ({Math.round(inspectedSample.confidence * 100)}%)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section 4: Side-by-Side Model Comparison Matrix */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
        <div>
          <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {ev.comparisonTitle}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{ev.comparisonDesc}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {trainedModels.map((m) => {
            const checked = compareIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleCompareModel(m.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  checked
                    ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {m.name}
              </button>
            );
          })}
        </div>

        {comparedModels.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse tabular-nums">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                  <th className="py-2.5 text-start font-medium">Model</th>
                  <th className="py-2.5 text-start font-medium">Architecture</th>
                  <th className="py-2.5 text-end font-medium">
                    {project.taskType === 'object_detection' ? ts.map50Label : ts.accuracyLabel}
                  </th>
                  <th className="py-2.5 text-end font-medium">{ts.f1Label}</th>
                  <th className="py-2.5 text-end font-medium">{ts.latencyLabel}</th>
                  <th className="py-2.5 text-end font-medium">{ts.modelSizeLabel}</th>
                  <th className="py-2.5 text-end font-medium">{ts.paramsLabel}</th>
                  <th className="py-2.5 text-end font-medium">Dataset</th>
                  <th className="py-2.5 text-start ps-4 font-medium">
                    {t.modelHub.officialReferenceBadge}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparedModels.map((m) => {
                  const primaryVal =
                    project.taskType === 'object_detection' ? m.mAP50 : m.accuracy;
                  const isBestScore = primaryVal > 0 && primaryVal === bestScore;
                  const isBestF1 = m.f1Score > 0 && m.f1Score === bestF1;
                  const isFastest =
                    m.inferenceLatencyMs > 0 && m.inferenceLatencyMs === fastestLatency;
                  const spec = getModelCatalogEntry(m.architecture);
                  const datasetMatchesActive =
                    !activeDataset ||
                    (m.datasetId === activeDataset.id &&
                      m.datasetVersion === activeDataset.version);
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-950/60"
                    >
                      <td className="py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                        <div>{m.name}</div>
                        {!datasetMatchesActive && (
                          <div className="text-[10px] text-amber-700 dark:text-amber-400">
                            {t.modelHub.datasetMismatchWarning}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-zinc-500">
                        {m.architecture} ({getPreprocessModeForArchitecture(m.architecture)})
                      </td>
                      <td className="py-2.5 text-end font-mono">
                        <span className={isBestScore ? 'text-red-600 font-semibold' : ''}>
                          {Math.round(primaryVal * 100)}%
                        </span>
                      </td>
                      <td className="py-2.5 text-end font-mono">
                        <span className={isBestF1 ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : ''}>
                          {Math.round(m.f1Score * 100)}%
                        </span>
                      </td>
                      <td className="py-2.5 text-end font-mono">
                        <span className={isFastest ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : ''}>
                          {m.inferenceLatencyMs} ms
                        </span>
                      </td>
                      <td className="py-2.5 text-end font-mono">
                        {formatBytes(m.weightSizeBytes)}
                      </td>
                      <td className="py-2.5 text-end font-mono">
                        {m.parameterCount.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-end font-mono">v{m.datasetVersion}</td>
                      <td className="py-2.5 ps-4 text-zinc-500 max-w-[200px] truncate">
                        {spec?.officialReferenceBenchmark || 'Local dataset only'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 5: Live Image & Camera Inference Lab */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {ev.liveLabTitle}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{ev.liveLabDesc}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={liveFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void runLivePredictionOnBlob(f);
              }}
            />
            <button
              type="button"
              disabled={!hasLocalWeights || runningLive}
              onClick={() => liveFileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              <span>{ev.uploadImageBtn}</span>
            </button>
            {!cameraActive ? (
              <button
                type="button"
                disabled={!hasLocalWeights}
                onClick={handleStartCamera}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{ev.startCameraBtn}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCaptureCameraFrame}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{ev.captureAndPredictBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={handleStopCamera}
                  className="px-3 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 whitespace-nowrap shrink-0"
                >
                  {ev.stopCameraBtn}
                </button>
              </>
            )}
          </div>
        </div>

        {liveError && <p className="text-xs text-red-600 dark:text-red-400">{liveError}</p>}

        {cameraActive && (
          <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black max-w-md">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-56 object-contain" />
          </div>
        )}

        {livePreviewUrl && livePred && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 flex justify-center">
              <div className="relative inline-block">
                <img
                  src={livePreviewUrl}
                  alt="Live inference input"
                  referrerPolicy="no-referrer"
                  className="max-h-72 object-contain"
                />
                {livePred.detections.map((det, idx) => (
                  <div
                    key={idx}
                    style={{
                      left: `${det.x * 100}%`,
                      top: `${det.y * 100}%`,
                      width: `${det.width * 100}%`,
                      height: `${det.height * 100}%`,
                    }}
                    className="absolute border-2 border-red-600 pointer-events-none"
                  >
                    <span className="bg-red-600 text-white text-[10px] px-1">
                      {det.className} {Math.round(det.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-mono text-zinc-500 tabular-nums">
                {ts.latencyLabel}: {livePred.latencyMs} ms
              </p>
              {livePred.taskType === 'image_classification' ? (
                <div className="space-y-2">
                  {livePred.classifications.map((c) => (
                    <div key={c.className} className="space-y-1">
                      <div className="flex justify-between tabular-nums">
                        <span className="font-medium">{c.className}</span>
                        <span className="font-mono">{Math.round(c.confidence * 100)}%</span>
                      </div>
                      <div className="h-1.5 rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-red-600"
                          style={{ width: `${Math.round(c.confidence * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {livePred.detections.length === 0 ? (
                    <p className="text-zinc-500">No objects detected above threshold.</p>
                  ) : (
                    livePred.detections.map((d, i) => (
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
              )}
            </div>
          </div>
        )}
      </div>

      {/* Section 6: Saved Evaluation Snapshots History */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
        <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
          {ev.savedReportsTitle}
        </h3>
        {evaluationReports.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{ev.savedReportsEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse tabular-nums">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500">
                  <th className="py-2 text-start font-medium">Model</th>
                  <th className="py-2 text-start font-medium">Split</th>
                  <th className="py-2 text-end font-medium">Samples</th>
                  <th className="py-2 text-end font-medium">
                    {project.taskType === 'object_detection' ? ts.map50Label : ts.accuracyLabel}
                  </th>
                  <th className="py-2 text-end font-medium">{ts.f1Label}</th>
                  <th className="py-2 text-end font-medium">{ev.avgLatencyLabel}</th>
                  <th className="py-2 text-end font-medium">Date</th>
                  <th className="py-2 text-end font-medium" />
                </tr>
              </thead>
              <tbody>
                {evaluationReports.map((rep) => (
                  <tr key={rep.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2.5 font-medium">{rep.modelName}</td>
                    <td className="py-2.5 uppercase font-mono text-[11px]">{rep.split}</td>
                    <td className="py-2.5 text-end font-mono">{rep.sampleCount}</td>
                    <td className="py-2.5 text-end font-mono text-red-600 font-semibold">
                      {Math.round(
                        (rep.taskType === 'object_detection' ? rep.mAP50 : rep.accuracy) * 100
                      )}
                      %
                    </td>
                    <td className="py-2.5 text-end font-mono">{Math.round(rep.f1Score * 100)}%</td>
                    <td className="py-2.5 text-end font-mono">{rep.avgLatencyMs} ms</td>
                    <td className="py-2.5 text-end text-zinc-500">{formatTimestamp(rep.createdAt)}</td>
                    <td className="py-2.5 text-end">
                      <button
                        type="button"
                        onClick={() => void deleteEvaluationReport(rep.id)}
                        className="inline-flex items-center gap-1 text-red-600 hover:underline"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{ev.deleteReportBtn}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
