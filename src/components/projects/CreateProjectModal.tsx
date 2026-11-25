import React, { useState } from 'react';
import { HardDrive, Cloud, X } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { createProject } from '../../services/firestoreService';
import type {
  FutureTaskType,
  Project,
  StorageProvider,
  TrainingMode,
  V1TaskType,
  Workspace,
} from '../../types/domain';

interface CreateProjectModalProps {
  open: boolean;
  ownerUid: string;
  workspaces: Workspace[];
  onClose: () => void;
  onCreated: (project: Project) => void;
}

const FUTURE_TASKS: { id: FutureTaskType; version: string }[] = [
  { id: 'image_segmentation', version: 'V1.5' },
  { id: 'anomaly_detection', version: 'V1.5' },
  { id: 'pose_estimation', version: 'V2.0' },
  { id: 'ocr_text', version: 'V2.0' },
  { id: 'video_recognition', version: 'V2.5' },
  { id: 'custom', version: 'V2.5' },
];

export function CreateProjectModal({
  open,
  ownerUid,
  workspaces,
  onClose,
  onCreated,
}: CreateProjectModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id || '');
  const [taskType, setTaskType] = useState<V1TaskType>('image_classification');
  const [trainingMode, setTrainingMode] = useState<TrainingMode>('beginner');
  const [storageLocation, setStorageLocation] = useState<StorageProvider>('local');
  const [cloudConsentGranted, setCloudConsentGranted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const activeWorkspaceId = workspaceId || workspaces[0]?.id || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!activeWorkspaceId) {
      setError('No workspace available. Please create a workspace first.');
      return;
    }
    if (storageLocation === 'cloud' && !cloudConsentGranted) {
      setError(t.projectModal.cloudConsentLabel);
      return;
    }

    setSubmitting(true);
    try {
      const created = await createProject({
        ownerUid,
        workspaceId: activeWorkspaceId,
        name,
        description,
        taskType,
        trainingMode,
        storageLocation,
        cloudConsentGranted,
      });
      setName('');
      setDescription('');
      setCloudConsentGranted(false);
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-xl"
      >
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-display font-bold">{t.projectModal.title}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t.projectModal.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.projectModal.namePlaceholder}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t.projectModal.workspaceLabel}
              </label>
              <select
                value={activeWorkspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.projectModal.descLabel}
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.projectModal.descPlaceholder}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          {/* V1.0 Active AI Tasks */}
          <div className="space-y-2.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.projectModal.taskLabel}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['image_classification', 'object_detection'] as const).map((task) => {
                const selected = taskType === task;
                return (
                  <button
                    key={task}
                    type="button"
                    onClick={() => setTaskType(task)}
                    className={`text-start p-4 rounded-xl border transition-colors ${
                      selected
                        ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {t.tasks[task]}
                      </span>
                      <span className="text-[11px] font-medium text-red-600 dark:text-red-500 shrink-0">
                        {t.tasks.availableV1}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {t.tasks[`${task}_desc`]}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Future Coming Soon Tasks (Explicitly disabled) */}
            <div className="pt-2">
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                {t.projectModal.futureTasksLabel}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FUTURE_TASKS.map((ft) => (
                  <div
                    key={ft.id}
                    aria-disabled="true"
                    className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 opacity-65 text-xs flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-zinc-700 dark:text-zinc-300">
                      {t.tasks[ft.id]}
                    </span>
                    <span className="text-[10px] text-zinc-500 shrink-0">
                      {ft.version} · {t.tasks.comingSoon}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Training Mode */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.projectModal.modeLabel}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['beginner', 'advanced'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTrainingMode(m)}
                  className={`text-start p-3.5 rounded-xl border transition-colors ${
                    trainingMode === m
                      ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20'
                      : 'border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <p className="text-sm font-semibold">
                    {m === 'beginner'
                      ? t.projectModal.beginnerMode
                      : t.projectModal.advancedMode}
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                    {m === 'beginner'
                      ? t.projectModal.beginnerDesc
                      : t.projectModal.advancedDesc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Storage & Privacy Boundary */}
          <div className="space-y-3">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.projectModal.storageLabel}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setStorageLocation('local');
                  setCloudConsentGranted(false);
                }}
                className={`text-start p-3.5 rounded-xl border transition-colors ${
                  storageLocation === 'local'
                    ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <HardDrive className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                  <span>{t.projectModal.localStorage}</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  {t.projectModal.localStorageDesc}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setStorageLocation('cloud')}
                className={`text-start p-3.5 rounded-xl border transition-colors ${
                  storageLocation === 'cloud'
                    ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Cloud className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                  <span>{t.projectModal.cloudStorage}</span>
                </div>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  {t.projectModal.cloudStorageDesc}
                </p>
              </button>
            </div>

            {storageLocation === 'cloud' && (
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cloudConsentGranted}
                  onChange={(e) => setCloudConsentGranted(e.target.checked)}
                  className="mt-0.5 accent-red-600"
                />
                <span>{t.projectModal.cloudConsentLabel}</span>
              </label>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              {t.projectModal.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
            >
              {submitting ? t.projectModal.creating : t.projectModal.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
