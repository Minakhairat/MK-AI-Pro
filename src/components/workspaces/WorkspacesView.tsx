import React, { useState } from 'react';
import { Boxes, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { createWorkspace } from '../../services/firestoreService';
import type { StorageProvider, Workspace, WorkspaceType } from '../../types/domain';

interface WorkspacesViewProps {
  workspaces: Workspace[];
}

export function WorkspacesView({ workspaces }: WorkspacesViewProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<WorkspaceType>('personal');
  const [storageProvider, setStorageProvider] = useState<StorageProvider>('local');
  const [region, setRegion] = useState('local-device');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setCreating(true);
    try {
      await createWorkspace({
        ownerUid: user.uid,
        name,
        type,
        storageProvider,
        cloudRegion: region,
      });
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100">
          {t.workspaceView.heading}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t.workspaceView.subheading}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workspaces List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3"
              >
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="inline-flex items-center gap-1.5">
                    <Boxes className="w-3.5 h-3.5 text-red-600 dark:text-red-500" />
                    {ws.type === 'personal'
                      ? t.workspaceView.personal
                      : t.workspaceView.team}
                  </span>
                  <span className="font-mono">{ws.cloudRegion}</span>
                </div>
                <h2 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
                  {ws.name}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">
                  {ws.id}
                </p>
              </div>
            ))}
          </div>

          {/* RBAC Governance Architecture */}
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-red-600 dark:text-red-500" />
              <h2 className="text-base font-display font-semibold">
                {t.workspaceView.rolesTitle}
              </h2>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t.workspaceView.rolesSubtitle}
            </p>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 pt-2">
              <li className="py-2">{t.workspaceView.roleOwner}</li>
              <li className="py-2">{t.workspaceView.roleAdmin}</li>
              <li className="py-2">{t.workspaceView.roleTrainer}</li>
              <li className="py-2">{t.workspaceView.roleAnnotator}</li>
              <li className="py-2">{t.workspaceView.roleViewer}</li>
            </ul>
          </div>
        </div>

        {/* Create Workspace Form */}
        <form
          onSubmit={handleCreate}
          className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-zinc-50 dark:bg-zinc-900 space-y-4 h-fit"
        >
          <h2 className="text-base font-display font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4 text-red-600 dark:text-red-500" />
            <span>{t.workspaceView.createWorkspace}</span>
          </h2>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.workspaceView.workspaceName}
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.workspaceView.workspaceType}
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as WorkspaceType)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="personal">{t.workspaceView.personal}</option>
              <option value="team">{t.workspaceView.team}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.workspaceView.storageMode}
            </label>
            <select
              value={storageProvider}
              onChange={(e) => {
                const val = e.target.value as StorageProvider;
                setStorageProvider(val);
                setRegion(val === 'local' ? 'local-device' : 'europe-west3');
              }}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="local">{t.projectModal.localStorage}</option>
              <option value="cloud">{t.projectModal.cloudStorage}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.workspaceView.regionLabel}
            </label>
            <input
              type="text"
              required
              maxLength={64}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {t.workspaceView.createAction}
          </button>
        </form>
      </div>
    </div>
  );
}
