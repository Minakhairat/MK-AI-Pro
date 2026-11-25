import React, { useMemo, useState } from 'react';
import {
  Activity,
  Cpu,
  FolderKanban,
  HardDrive,
  Plus,
  Search,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import type { ActivityLog, Project, TrainingRun, UserProfile, V1TaskType } from '../../types/domain';
import { EmptyState } from '../common/EmptyState';

interface DashboardViewProps {
  mode: 'dashboard' | 'projects';
  profile: UserProfile | null;
  projects: Project[];
  activityLogs: ActivityLog[];
  trainingRuns: TrainingRun[];
  loadingProjects: boolean;
  onCreateProject: () => void;
  onOpenProject: (project: Project) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(ts: unknown, locale: string): string {
  if (!ts) return '—';
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    const fn = (ts as { toDate?: () => Date }).toDate;
    if (typeof fn === 'function') {
      return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(fn.call(ts));
    }
  }
  return '—';
}

export function DashboardView({
  mode,
  profile,
  projects,
  activityLogs,
  trainingRuns,
  loadingProjects,
  onCreateProject,
  onOpenProject,
}: DashboardViewProps) {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState<'all' | V1TaskType>('all');

  const totalModels = useMemo(
    () => projects.reduce((acc, p) => acc + (p.modelCount || 0), 0),
    [projects]
  );
  const totalApps = useMemo(
    () => projects.reduce((acc, p) => acc + (p.appCount || 0), 0),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchesTask = taskFilter === 'all' || p.taskType === taskFilter;
      const q = search.trim().toLowerCase();
      const matchesQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q);
      return matchesTask && matchesQuery;
    });
  }, [projects, search, taskFilter]);

  const storageUsed = profile?.storageUsedBytes ?? 0;
  const storageQuota = profile?.storageQuotaBytes ?? 5_368_709_120;
  const creditsBalance = profile?.cloudCreditsBalance ?? 100;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100">
            {mode === 'dashboard' ? t.dashboard.heading : t.dashboard.projectsTitle}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {t.dashboard.subheading}
          </p>
        </div>
      </div>

      {/* KPI Summary Strip (Dashboard Mode) */}
      {mode === 'dashboard' && (
        <section className="grid grid-cols-2 md:grid-cols-5 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 divide-y md:divide-y-0 md:divide-x rtl:md:divide-x-reverse divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
          <div className="p-5">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t.dashboard.totalProjects}
            </p>
            <p className="mt-2 text-2xl font-display font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {projects.length}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t.dashboard.trainedModels}
            </p>
            <p className="mt-2 text-2xl font-display font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {totalModels}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t.dashboard.generatedApps}
            </p>
            <p className="mt-2 text-2xl font-display font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {totalApps}
            </p>
          </div>
          <div className="p-5">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t.dashboard.storageUsed}
            </p>
            <p className="mt-2 text-lg font-display font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatBytes(storageUsed)}{' '}
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                / {formatBytes(storageQuota)}
              </span>
            </p>
          </div>
          <div className="p-5 col-span-2 md:col-span-1">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {t.dashboard.cloudCredits}
            </p>
            <p className="mt-2 text-2xl font-display font-bold tabular-nums text-red-600 dark:text-red-500">
              {creditsBalance}
            </p>
          </div>
        </section>
      )}

      {/* Projects Section */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.dashboard.projectsTitle}
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-zinc-400 absolute top-2.5 start-3 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.dashboard.searchPlaceholder}
                className="ps-9 pe-3 py-1.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div className="flex items-center p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              {(
                [
                  { id: 'all', label: t.dashboard.filterAll },
                  { id: 'image_classification', label: t.tasks.image_classification },
                  { id: 'object_detection', label: t.tasks.object_detection },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTaskFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    taskFilter === tab.id
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadingProjects ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-40 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900"
              />
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={t.dashboard.projectsEmpty}
            description={t.dashboard.projectsEmptyDesc}
            actionLabel={t.dashboard.createFirstProject}
            onAction={onCreateProject}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpenProject(project)}
                className="text-start border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 hover:border-red-600/60 dark:hover:border-red-500/60 transition-colors flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="truncate">
                      {t.tasks[project.taskType]} · {project.engineVersion.toUpperCase()}
                    </span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300 shrink-0">
                      {t.statuses[project.status]}
                    </span>
                  </div>
                  <h3 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {project.name}
                  </h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                    {project.description || t.common.noDescription}
                  </p>
                </div>

                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  <span>
                    {project.datasetCount} {t.common.datasets} · {project.modelCount}{' '}
                    {t.common.models} · {project.appCount} {t.common.apps}
                  </span>
                  <span className="font-medium text-red-600 dark:text-red-500 inline-flex items-center gap-1 shrink-0">
                    {t.common.openWorkspace}
                  </span>
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={onCreateProject}
              className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-5 flex flex-col items-center justify-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-500 hover:border-red-600/60 transition-colors min-h-[160px]"
            >
              <Plus className="w-5 h-5" />
              <span className="text-sm font-medium">{t.topBar.newProject}</span>
            </button>
          </div>
        )}
      </section>

      {/* Recent Training + Activity Feed (Dashboard Mode) */}
      {mode === 'dashboard' && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              <Cpu className="w-4 h-4 text-red-600 dark:text-red-500" />
              <h2 className="text-base font-display font-semibold">
                {t.dashboard.recentTrainingTitle}
              </h2>
            </div>
            {trainingRuns.length === 0 ? (
              <div className="py-6 text-center space-y-1.5 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {t.dashboard.recentTrainingEmpty}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
                  {t.dashboard.recentTrainingEmptyDesc}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border-t border-zinc-100 dark:border-zinc-800">
                {trainingRuns.slice(0, 6).map((run) => (
                  <div
                    key={run.id}
                    className="py-3 flex items-center justify-between gap-4 text-xs tabular-nums"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate block">
                        {run.architecture}
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {run.currentEpoch}/{run.totalEpochs} epochs · {run.hardwareSummary}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-red-600 dark:text-red-500 shrink-0">
                      {(run.bestValMetric * 100).toFixed(1)}% · {run.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
              <Activity className="w-4 h-4 text-red-600 dark:text-red-500" />
              <h2 className="text-base font-display font-semibold">
                {t.dashboard.activityTitle}
              </h2>
            </div>

            {activityLogs.length === 0 ? (
              <div className="py-6 text-center border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.dashboard.activityEmpty}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border-t border-zinc-100 dark:border-zinc-800">
                {activityLogs.slice(0, 6).map((log) => (
                  <div
                    key={log.id}
                    className="py-3 flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {t.actions[log.action]}{' '}
                      </span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {log.targetName}
                      </span>
                    </div>
                    <span className="text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                      {formatTimestamp(log.createdAt, locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
