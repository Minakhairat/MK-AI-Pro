import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { getDesktopBridge } from '../../lib/desktopClient';
import type {
  DependencyInstallProgress,
  ExecutionProfile,
  SetupStepStatus,
  SetupWizardState,
} from '../../types/desktop';

interface DesktopSetupWizardProps {
  open: boolean;
  onClose: () => void;
  onCompleted?: (state: SetupWizardState) => void;
}

export function DesktopSetupWizard({
  open,
  onClose,
  onCompleted,
}: DesktopSetupWizardProps) {
  const { t, locale } = useI18n();
  const [wizardState, setWizardState] = useState<SetupWizardState | null>(null);
  const [depProgress, setDepProgress] = useState<DependencyInstallProgress | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ExecutionProfile>('cpu');
  const [busy, setBusy] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const bridge = getDesktopBridge();
    if (!bridge) return;

    let mounted = true;
    void Promise.all([bridge.getSetupWizardState(), bridge.detectHardware(false)])
      .then(([st, hw]) => {
        if (!mounted) return;
        setWizardState(st);
        setSelectedProfile(hw.recommendedProfile);
      })
      .catch(() => {});

    const unsubSetup = bridge.onSetupProgress((st) => {
      if (mounted) setWizardState(st);
    });
    const unsubDeps = bridge.onDependencyProgress((prog) => {
      if (mounted) setDepProgress(prog);
    });

    return () => {
      mounted = false;
      unsubSetup();
      unsubDeps();
    };
  }, [open]);

  if (!open) return null;

  const handleRunWizard = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const result = await bridge.runSetupWizard({ profile: selectedProfile });
      setWizardState(result);
      onCompleted?.(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Setup verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRepairEnv = async () => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setRepairBusy(true);
    setErrorMsg(null);
    try {
      const prog = await bridge.installOrRepairPythonEnv({
        profile: selectedProfile,
        repair: true,
      });
      setDepProgress(prog);
      const result = await bridge.runSetupWizard({ profile: selectedProfile });
      setWizardState(result);
      onCompleted?.(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Automatic Python environment repair failed.');
    } finally {
      setRepairBusy(false);
    }
  };

  const renderStatusIcon = (status: SetupStepStatus) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-red-600 animate-spin shrink-0" />;
      default:
        return <span className="w-2.5 h-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700 shrink-0" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-display font-bold text-zinc-900 dark:text-zinc-100">
              {t.setupWizard.title}
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t.setupWizard.subtitle}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Profile & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
            <div className="flex items-center gap-3 text-xs">
              <label className="font-medium text-zinc-700 dark:text-zinc-300">
                {t.setupWizard.profileLabel}
              </label>
              <select
                disabled={busy || repairBusy}
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value as ExecutionProfile)}
                className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono text-xs"
              >
                <option value="nvidia_gpu">NVIDIA CUDA GPU (cu121)</option>
                <option value="cpu">Standard CPU Runtime</option>
                <option value="safe_compatibility">Safe Compatibility Mode</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || repairBusy}
                onClick={() => void handleRepairEnv()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                <Wrench className={`w-3.5 h-3.5 ${repairBusy ? 'animate-spin' : ''}`} />
                <span>{t.setupWizard.repairBtn}</span>
              </button>
              <button
                type="button"
                disabled={busy || repairBusy}
                onClick={() => void handleRunWizard()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span>{busy ? t.setupWizard.runningBtn : t.setupWizard.runWizardBtn}</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-400">
              {errorMsg}
            </div>
          )}

          {/* Live Pip Dependency Progress */}
          {depProgress && depProgress.stage !== 'idle' && (
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-2 text-xs">
              <div className="flex items-center justify-between font-mono tabular-nums">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {depProgress.stage.toUpperCase()} · {depProgress.currentPackage}
                </span>
                <span>{depProgress.progressPct}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-red-600 transition-all duration-300"
                  style={{ width: `${Math.min(100, depProgress.progressPct)}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                {depProgress.message}
              </p>
            </div>
          )}

          {/* Readiness Summary Banner */}
          {wizardState?.completed && (
            <div
              className={`p-3.5 rounded-lg border text-xs ${
                wizardState.overallReady
                  ? 'border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/15 text-emerald-800 dark:text-emerald-300'
                  : 'border-amber-300 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/15 text-amber-800 dark:text-amber-300'
              }`}
            >
              {wizardState.overallReady ? t.setupWizard.readyBanner : t.setupWizard.partialBanner}
            </div>
          )}

          {/* 10-Step Verification Checklist */}
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900">
            {(wizardState?.steps ?? []).map((step) => (
              <div key={step.id} className="p-3.5 flex items-start justify-between gap-4 text-xs">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5">{renderStatusIcon(step.status)}</div>
                  <div className="min-w-0 space-y-1">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      <span className="font-mono text-zinc-400 me-2">
                        {String(step.order).padStart(2, '0')}
                      </span>
                      {locale === 'ar' ? step.titleAr : step.titleEn}
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-400 break-words">{step.detail}</p>
                    {step.status === 'failed' && (step.userActionEn || step.userActionAr) && (
                      <p className="text-[11px] text-red-700 dark:text-red-400">
                        {locale === 'ar' ? step.userActionAr : step.userActionEn}
                      </p>
                    )}
                  </div>
                </div>
                <span className="font-mono tabular-nums text-[11px] text-zinc-400 shrink-0">
                  {step.durationMs > 0 ? `${step.durationMs} ${t.setupWizard.stepDurationUnit}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-3 bg-zinc-50 dark:bg-zinc-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
          >
            {t.setupWizard.continueDesktopBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
