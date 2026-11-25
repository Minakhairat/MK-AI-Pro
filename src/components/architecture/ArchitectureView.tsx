import React, { useEffect, useState } from 'react';
import { Cloud, Cpu, RefreshCw, Server } from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { fetchBackendHealth, pingAiEngine } from '../../lib/apiClient';
import type { AiEnginePingResponse, BackendHealthResponse } from '../../types/domain';

export function ArchitectureView() {
  const { t } = useI18n();
  const [health, setHealth] = useState<BackendHealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [aiPing, setAiPing] = useState<AiEnginePingResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    setHealthError(null);
    try {
      const [h, p] = await Promise.all([fetchBackendHealth(), pingAiEngine()]);
      setHealth(h);
      setAiPing(p);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Status check failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const roadmapPhases = [
    {
      title: t.projectWorkspace.phase1Title,
      desc: t.projectWorkspace.phase1Desc,
      status: 'active',
    },
    {
      title: t.projectWorkspace.phase2Title,
      desc: t.projectWorkspace.phase2Desc,
      status: 'active',
    },
    {
      title: t.projectWorkspace.phase3Title,
      desc: t.projectWorkspace.phase3Desc,
      status: 'active',
    },
    {
      title: t.projectWorkspace.phase4Title,
      desc: t.projectWorkspace.phase4Desc,
      status: 'active',
    },
    {
      title: t.projectWorkspace.phase5Title,
      desc: t.projectWorkspace.phase5Desc,
      status: 'active',
    },
    {
      title: t.projectWorkspace.phase6Title,
      desc: t.projectWorkspace.phase6Desc,
      status: 'planned',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-zinc-900 dark:text-zinc-100">
            {t.architectureView.heading}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {t.architectureView.subheading}
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadStatus()}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{t.architectureView.refreshHealth}</span>
        </button>
      </div>

      {healthError && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {healthError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Express API Gateway */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-display font-semibold text-sm">
              <Server className="w-4 h-4 text-red-600 dark:text-red-500" />
              <span>{t.architectureView.backendHealthTitle}</span>
            </div>
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {health?.status === 'ok'
                ? t.architectureView.statusOk
                : t.architectureView.statusOffline}
            </span>
          </div>
          {health && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 tabular-nums pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <p>
                Service: <span className="font-mono">{health.service}</span>
              </p>
              <p>
                Uptime: <span className="font-mono">{health.uptimeSeconds}s</span>
              </p>
              <p>
                Phase: <span className="font-mono">{health.phase}</span>
              </p>
            </div>
          )}
        </div>

        {/* Cloud Adapters */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-3">
          <div className="flex items-center gap-2 font-display font-semibold text-sm">
            <Cloud className="w-4 h-4 text-red-600 dark:text-red-500" />
            <span>{t.architectureView.cloudAdapterTitle}</span>
          </div>
          {health && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <div>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  {t.architectureView.storageAdapter}:{' '}
                </span>
                <span className="font-mono">
                  {health.adapters.storage.provider} ({health.adapters.storage.region})
                </span>
              </div>
              <div>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">
                  {t.architectureView.computeAdapter}:{' '}
                </span>
                <span className="font-mono">{health.adapters.compute.provider}</span>
              </div>
              <p className="text-zinc-500">{health.adapters.storage.description}</p>
            </div>
          )}
        </div>

        {/* Python AI Engine Probe */}
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-display font-semibold text-sm">
              <Cpu className="w-4 h-4 text-red-600 dark:text-red-500" />
              <span>{t.architectureView.aiEngineProbeTitle}</span>
            </div>
            <span
              className={`text-xs font-medium ${
                aiPing?.reachable
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {aiPing?.reachable
                ? t.projectWorkspace.engineOnline
                : aiPing?.status === 'not_configured'
                ? t.projectWorkspace.engineNotConfigured
                : t.projectWorkspace.engineOffline}
            </span>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed pt-2 border-t border-zinc-100 dark:border-zinc-800">
            {aiPing?.message || t.projectWorkspace.noFakeTrainingRule}
          </p>
        </div>
      </div>

      {/* Roadmap */}
      <section className="space-y-4">
        <h2 className="text-lg font-display font-semibold text-zinc-900 dark:text-zinc-100">
          {t.architectureView.roadmapTitle}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roadmapPhases.map((phase) => (
            <div
              key={phase.title}
              className={`border rounded-xl p-5 space-y-2 ${
                phase.status === 'active'
                  ? 'border-red-600/60 bg-red-50/30 dark:bg-red-950/10'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
                  {phase.title}
                </h3>
                <span
                  className={`text-[11px] font-medium shrink-0 ${
                    phase.status === 'active'
                      ? 'text-red-600 dark:text-red-500'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {phase.status === 'active' ? t.architectureView.statusOk : t.tasks.comingSoon}
                </span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {phase.desc}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
