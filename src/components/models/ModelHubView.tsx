import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CheckCircle2,
  Code2,
  Cpu,
  Download,
  Edit3,
  FileJson,
  FileSpreadsheet,
  Rocket,
  Search,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import {
  exportPortableMkModelBundle,
  exportStoredModelArtifacts,
  generateIntegrationSnippets,
  generateModelCardReport,
  listStoredModelKeys,
} from '../../lib/localModelStore';
import {
  deleteTrainedModel,
  logActivity,
  renameTrainedModel,
  setActiveTrainedModel,
} from '../../services/firestoreService';
import type { EvaluationReport, Project, TrainedModel } from '../../types/domain';

interface ModelHubViewProps {
  project: Project;
  trainedModels: TrainedModel[];
  evaluationReports: EvaluationReport[];
  onOpenTraining: () => void;
  onOpenAppBuilder: () => void;
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

export function ModelHubView({
  project,
  trainedModels,
  evaluationReports,
  onOpenTraining,
  onOpenAppBuilder,
}: ModelHubViewProps) {
  const { t } = useI18n();
  const mh = t.modelHub;
  const ts = t.trainingStudio;

  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'on_device'>('all');
  const [localWeightKeys, setLocalWeightKeys] = useState<Set<string>>(new Set());
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // Assign chronological version tags (v1 oldest -> vN newest)
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
    setActionError(null);
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

  if (trainedModels.length === 0) {
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 bg-white dark:bg-zinc-900 text-center space-y-4">
        <Box className="w-8 h-8 text-red-600 mx-auto" />
        <div className="space-y-1.5 max-w-md mx-auto">
          <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {mh.emptyTitle}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{mh.emptyDesc}</p>
        </div>
        <button
          type="button"
          onClick={onOpenTraining}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          <Cpu className="w-4 h-4" />
          <span>{t.evaluationStudio.goToTrainingBtn}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Search/Filter Toolbar */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {mh.heading}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{mh.subheading}</p>
          </div>
          <button
            type="button"
            onClick={onOpenAppBuilder}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{mh.continueAppBuilderBtn}</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
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
      </div>

      {actionError && <p className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}

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
    </div>
  );
}
