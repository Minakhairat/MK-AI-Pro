import React, { useEffect, useState } from 'react';
import {
  Box,
  CheckCircle2,
  Cpu,
  Database,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  Rocket,
  Settings,
  Smartphone,
  Target,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import {
  deleteProject,
  subscribeDatasetItems,
  subscribeProjectDatasets,
  subscribeProjectEvaluationReports,
  subscribeProjectGeneratedApps,
  subscribeProjectTrainedModels,
  subscribeProjectTrainingRuns,
  updateProjectSettings,
} from '../../services/firestoreService';
import type {
  Dataset,
  DatasetItem,
  EvaluationReport,
  GeneratedApp,
  Project,
  ProjectStageTab,
  StorageProvider,
  TrainedModel,
  TrainingMode,
  TrainingRun,
} from '../../types/domain';
import { AppBuilderStudio } from '../appbuilder/AppBuilderStudio';
import { AnnotationStudio } from '../dataset/AnnotationStudio';
import { DatasetStudio } from '../dataset/DatasetStudio';
import { EvaluationStudio } from '../evaluation/EvaluationStudio';
import { ModelHubView } from '../models/ModelHubView';
import { TrainingStudio } from '../training/TrainingStudio';

interface ProjectWorkspaceViewProps {
  project: Project;
  onDeleted: () => void;
}

const INSPECTOR_STORAGE_KEY = 'mk_ai_inspector_open';

export function ProjectWorkspaceView({
  project,
  onDeleted,
}: ProjectWorkspaceViewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<ProjectStageTab>('overview');
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(INSPECTOR_STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  // Phase 2 Datasets & Items
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [datasetItems, setDatasetItems] = useState<DatasetItem[]>([]);
  const [annotatorTargetItemId, setAnnotatorTargetItemId] = useState<string | null>(null);
  const [preselectedArchId, setPreselectedArchId] = useState<string | null>(null);

  // Phase 3, Phase 4 & Phase 5 Training Runs, Trained Models, Evaluation Reports & Generated Apps
  const [trainingRuns, setTrainingRuns] = useState<TrainingRun[]>([]);
  const [trainedModels, setTrainedModels] = useState<TrainedModel[]>([]);
  const [evaluationReports, setEvaluationReports] = useState<EvaluationReport[]>([]);
  const [generatedApps, setGeneratedApps] = useState<GeneratedApp[]>([]);

  // Project settings form
  const [editName, setEditName] = useState(project.name);
  const [editDesc, setEditDesc] = useState(project.description);
  const [editMode, setEditMode] = useState<TrainingMode>(project.trainingMode);
  const [editStorage, setEditStorage] = useState<StorageProvider>(project.storageLocation);
  const [editConsent, setEditConsent] = useState<boolean>(project.cloudConsentGranted);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setEditName(project.name);
    setEditDesc(project.description);
    setEditMode(project.trainingMode);
    setEditStorage(project.storageLocation);
    setEditConsent(project.cloudConsentGranted);
    setConfirmDelete(false);
    setSaveMsg(null);
    setSaveErr(null);
  }, [project]);

  useEffect(() => {
    const unsub = subscribeProjectDatasets(
      project.id,
      project.ownerUid,
      (list) => {
        setDatasets(list);
        if (list.length > 0 && !list.some((d) => d.id === selectedDatasetId)) {
          setSelectedDatasetId(list[0].id);
        } else if (list.length === 0) {
          setSelectedDatasetId(null);
        }
      }
    );
    return () => unsub();
  }, [project.id, project.ownerUid]);

  const activeDataset = datasets.find((d) => d.id === selectedDatasetId) || datasets[0] || null;

  useEffect(() => {
    if (!activeDataset) {
      setDatasetItems([]);
      return;
    }
    const unsub = subscribeDatasetItems(
      activeDataset.id,
      project.ownerUid,
      (items) => setDatasetItems(items)
    );
    return () => unsub();
  }, [activeDataset?.id, project.ownerUid]);

  useEffect(() => {
    const unsubRuns = subscribeProjectTrainingRuns(
      project.id,
      project.ownerUid,
      (runs) => setTrainingRuns(runs)
    );
    const unsubModels = subscribeProjectTrainedModels(
      project.id,
      project.ownerUid,
      (models) => setTrainedModels(models)
    );
    const unsubReports = subscribeProjectEvaluationReports(
      project.id,
      project.ownerUid,
      (reports) => setEvaluationReports(reports)
    );
    const unsubApps = subscribeProjectGeneratedApps(
      project.id,
      project.ownerUid,
      (apps) => setGeneratedApps(apps)
    );
    return () => {
      unsubRuns();
      unsubModels();
      unsubReports();
      unsubApps();
    };
  }, [project.id, project.ownerUid]);

  const toggleInspector = () => {
    const next = !inspectorOpen;
    setInspectorOpen(next);
    try {
      window.localStorage.setItem(INSPECTOR_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    setSaveErr(null);
    try {
      await updateProjectSettings({
        projectId: project.id,
        ownerUid: project.ownerUid,
        name: editName,
        description: editDesc,
        trainingMode: editMode,
        storageLocation: editStorage,
        cloudConsentGranted: editConsent,
      });
      setSaveMsg(t.projectWorkspace.savedNotice);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.id, project.ownerUid, project.name);
      onDeleted();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to delete project.');
      setDeleting(false);
    }
  };

  const tabs: {
    id: ProjectStageTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'overview', label: t.projectWorkspace.tabs.overview, icon: Layers },
    { id: 'dataset', label: t.projectWorkspace.tabs.dataset, icon: Database },
    { id: 'annotation', label: t.projectWorkspace.tabs.annotation, icon: Target },
    { id: 'training', label: t.projectWorkspace.tabs.training, icon: Cpu },
    { id: 'evaluation', label: t.projectWorkspace.tabs.evaluation, icon: CheckCircle2 },
    { id: 'model_hub', label: t.projectWorkspace.tabs.model_hub, icon: Box },
    { id: 'app_builder', label: t.projectWorkspace.tabs.app_builder, icon: Smartphone },
    { id: 'deployment', label: t.projectWorkspace.tabs.deployment, icon: Rocket },
    { id: 'settings', label: t.projectWorkspace.tabs.settings, icon: Settings },
  ];

  const phaseCards = [
    {
      active: true,
      title: t.projectWorkspace.phase1Title,
      desc: t.projectWorkspace.phase1Desc,
    },
    {
      active: true,
      title: t.projectWorkspace.phase2Title,
      desc: t.projectWorkspace.phase2Desc,
    },
    {
      active: true,
      title: t.projectWorkspace.phase3Title,
      desc: t.projectWorkspace.phase3Desc,
    },
    {
      active: true,
      title: t.projectWorkspace.phase4Title,
      desc: t.projectWorkspace.phase4Desc,
    },
    {
      active: true,
      title: t.projectWorkspace.phase5Title,
      desc: t.projectWorkspace.phase5Desc,
    },
    {
      active: false,
      title: t.projectWorkspace.phase6Title,
      desc: t.projectWorkspace.phase6Desc,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Project Header & Flexible Panel Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div className="min-w-0">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {t.tasks[project.taskType]} · {project.engineVersion.toUpperCase()} ·{' '}
            {project.storageLocation === 'local'
              ? t.projectModal.localStorage
              : t.projectModal.cloudStorage}
          </div>
          <h1 className="text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100 mt-1 truncate">
            {project.name}
          </h1>
        </div>

        <button
          type="button"
          onClick={toggleInspector}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 whitespace-nowrap shrink-0"
        >
          {inspectorOpen ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRightOpen className="w-4 h-4" />
          )}
          <span>{t.projectWorkspace.togglePanels}</span>
        </button>
      </div>

      {/* Stage Navigation Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'border-red-600 text-red-600 dark:text-red-500 bg-zinc-50 dark:bg-zinc-900/60'
                  : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content + Flexible Side Inspector */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          inspectorOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-1'
        }`}
      >
        <div className={inspectorOpen ? 'lg:col-span-2 space-y-6' : 'space-y-6'}>
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-3">
                <h2 className="text-base font-display font-semibold">
                  {t.projectWorkspace.pipelineReadiness}
                </h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {project.description || t.common.noDescription}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {phaseCards.map((card) => (
                  <div
                    key={card.title}
                    className={`border rounded-xl p-5 space-y-2 ${
                      card.active
                        ? 'border-red-600/50 bg-red-50/30 dark:bg-red-950/10'
                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
                        {card.title}
                      </h3>
                      <span
                        className={`text-[11px] font-medium shrink-0 ${
                          card.active
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {card.active ? t.architectureView.statusOk : t.tasks.comingSoon}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {card.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'dataset' && (
            <DatasetStudio
              project={project}
              datasets={datasets}
              activeDataset={activeDataset}
              items={datasetItems}
              onSelectDataset={(dsId) => setSelectedDatasetId(dsId)}
              onOpenAnnotator={(itemId) => {
                setAnnotatorTargetItemId(itemId || null);
                setActiveTab('annotation');
              }}
            />
          )}

          {activeTab === 'annotation' && (
            <AnnotationStudio
              project={project}
              dataset={activeDataset}
              items={datasetItems}
              initialItemId={annotatorTargetItemId}
            />
          )}

          {activeTab === 'training' && (
            <TrainingStudio
              project={project}
              datasets={datasets}
              activeDataset={activeDataset}
              items={datasetItems}
              trainingRuns={trainingRuns}
              trainedModels={trainedModels}
              initialArchId={preselectedArchId}
              onSelectDataset={(dsId) => setSelectedDatasetId(dsId)}
            />
          )}

          {activeTab === 'evaluation' && (
            <EvaluationStudio
              project={project}
              datasets={datasets}
              activeDataset={activeDataset}
              items={datasetItems}
              trainedModels={trainedModels}
              evaluationReports={evaluationReports}
              onOpenTraining={() => setActiveTab('training')}
            />
          )}

          {activeTab === 'model_hub' && (
            <ModelHubView
              project={project}
              datasets={datasets}
              activeDataset={activeDataset}
              trainedModels={trainedModels}
              evaluationReports={evaluationReports}
              onOpenTraining={(archId) => {
                setPreselectedArchId(archId || null);
                setActiveTab('training');
              }}
              onOpenAppBuilder={() => setActiveTab('app_builder')}
            />
          )}

          {activeTab === 'app_builder' && (
            <AppBuilderStudio
              project={project}
              trainedModels={trainedModels}
              generatedApps={generatedApps}
              onOpenTraining={() => setActiveTab('training')}
            />
          )}

          {activeTab === 'deployment' && (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 bg-white dark:bg-zinc-900 space-y-3">
              <p className="text-xs font-medium text-red-600 dark:text-red-500">
                {t.projectWorkspace.tabs.deployment}
              </p>
              <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
                {t.projectWorkspace.phase6Title}
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-2xl">
                {t.projectWorkspace.phase6Desc}
              </p>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <form
                onSubmit={handleSaveSettings}
                className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      {t.projectModal.nameLabel}
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={100}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      {t.projectModal.modeLabel}
                    </label>
                    <select
                      value={editMode}
                      onChange={(e) => setEditMode(e.target.value as TrainingMode)}
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                    >
                      <option value="beginner">{t.projectModal.beginnerMode}</option>
                      <option value="advanced">{t.projectModal.advancedMode}</option>
                      <option value="expert">{t.projectModal.expertMode}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    {t.projectModal.descLabel}
                  </label>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
                  />
                </div>

                <div className="space-y-3">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {t.projectModal.storageLabel}
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {(['local', 'cloud'] as const).map((loc) => (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => {
                          setEditStorage(loc);
                          if (loc === 'local') setEditConsent(false);
                        }}
                        className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
                          editStorage === loc
                            ? 'border-red-600 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                            : 'border-zinc-200 dark:border-zinc-800'
                        }`}
                      >
                        {loc === 'local'
                          ? t.projectModal.localStorage
                          : t.projectModal.cloudStorage}
                      </button>
                    ))}
                  </div>
                  {editStorage === 'cloud' && (
                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editConsent}
                        onChange={(e) => setEditConsent(e.target.checked)}
                        className="mt-0.5 accent-red-600"
                      />
                      <span>{t.projectModal.cloudConsentLabel}</span>
                    </label>
                  )}
                </div>

                {saveErr && (
                  <p className="text-xs text-red-600 dark:text-red-400">{saveErr}</p>
                )}
                {saveMsg && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">{saveMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  {saving ? t.projectWorkspace.saving : t.projectWorkspace.saveSettings}
                </button>
              </form>

              <div className="border border-red-200 dark:border-red-900/60 rounded-xl p-6 bg-red-50/30 dark:bg-red-950/10 space-y-3">
                <h3 className="text-sm font-display font-semibold text-red-700 dark:text-red-400">
                  {t.projectWorkspace.dangerZone}
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  {t.projectWorkspace.deleteConfirm}
                </p>
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.projectWorkspace.deleteProject}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={handleDelete}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      {t.projectWorkspace.confirmDeleteBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700"
                    >
                      {t.projectModal.cancel}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Collapsible Side Inspector */}
        {inspectorOpen && (
          <aside className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-zinc-50 dark:bg-zinc-900 space-y-5 h-fit">
            <div className="space-y-1">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Project ID
              </p>
              <p className="text-xs font-mono text-zinc-800 dark:text-zinc-200 break-all">
                {project.id}
              </p>
            </div>

            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">Task</span>
                <span className="font-medium">{t.tasks[project.taskType]}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">Mode</span>
                <span className="font-medium">
                  {project.trainingMode === 'beginner'
                    ? t.projectModal.beginnerMode
                    : project.trainingMode === 'advanced'
                    ? t.projectModal.advancedMode
                    : t.projectModal.expertMode}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 dark:text-zinc-400">Status</span>
                <span className="font-medium">{t.statuses[project.status]}</span>
              </div>
              <div className="flex items-center justify-between tabular-nums">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {t.common.datasets}
                </span>
                <span className="font-mono font-semibold">{datasets.length}</span>
              </div>
              <div className="flex items-center justify-between tabular-nums">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {t.datasetStudio.totalImages}
                </span>
                <span className="font-mono font-semibold">{datasetItems.length}</span>
              </div>
              <div className="flex items-center justify-between tabular-nums">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {t.common.models}
                </span>
                <span className="font-mono font-semibold">{project.modelCount}</span>
              </div>
              <div className="flex items-center justify-between tabular-nums">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {t.common.apps}
                </span>
                <span className="font-mono font-semibold">{project.appCount}</span>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
