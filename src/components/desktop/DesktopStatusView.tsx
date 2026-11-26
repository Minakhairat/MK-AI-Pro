import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  Cpu,
  Download,
  FileDown,
  FolderOpen,
  HardDrive,
  KeyRound,
  Monitor,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { getDesktopBridge, isDesktopApp } from '../../lib/desktopClient';
import { evaluateModelHardwareCompatibility } from '../../lib/hardwareCompatibility';
import { MODEL_CATALOG } from '../../lib/modelRegistry';
import type {
  DesktopConfig,
  DesktopRuntimeInfo,
  DesktopWeightRecord,
  EngineRuntimeStatus,
  EngineTokenStatus,
  HardwareReport,
  StorageSubdirName,
  StorageUsageSummary,
  UpdateCheckReport,
} from '../../types/desktop';

interface DesktopStatusViewProps {
  onOpenWizard?: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function DesktopStatusView({ onOpenWizard }: DesktopStatusViewProps) {
  const { t, locale } = useI18n();
  const desktopMode = isDesktopApp();

  const [runtimeInfo, setRuntimeInfo] = useState<DesktopRuntimeInfo | null>(null);
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineRuntimeStatus | null>(null);
  const [tokenStatus, setTokenStatus] = useState<EngineTokenStatus | null>(null);
  const [hardware, setHardware] = useState<HardwareReport | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsageSummary | null>(null);
  const [localWeights, setLocalWeights] = useState<DesktopWeightRecord[]>([]);
  const [updateReport, setUpdateReport] = useState<UpdateCheckReport | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadDesktopSnapshot = async (forceHardware = false) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    try {
      const [info, cfg, eng, tok, hw, usage, weights, updates] = await Promise.all([
        bridge.getRuntimeInfo(),
        bridge.getConfig(),
        bridge.getEngineStatus(),
        bridge.getEngineTokenStatus(),
        bridge.detectHardware(forceHardware),
        bridge.getStorageUsage(),
        bridge.listLocalWeights(),
        bridge.checkForUpdates(),
      ]);
      setRuntimeInfo(info);
      setConfig(cfg);
      setEngineStatus(eng);
      setTokenStatus(tok);
      setHardware(hw);
      setStorageUsage(usage);
      setLocalWeights(weights);
      setUpdateReport(updates);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed loading Desktop status.');
    }
  };

  useEffect(() => {
    if (desktopMode) {
      void loadDesktopSnapshot(false);
    }
  }, [desktopMode]);

  const compatibilityList = useMemo(
    () =>
      MODEL_CATALOG.map((spec) => ({
        spec,
        compat: evaluateModelHardwareCompatibility(spec, hardware, localWeights),
      })),
    [hardware, localWeights]
  );

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    setNotice(null);
    setErrorMsg(null);
    try {
      await fn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Desktop operation failed.');
    } finally {
      setBusyAction(null);
    }
  };

  // Web Browser Mode View (GitHub Pages / Standard Web)
  if (!desktopMode) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-display font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t.desktopView.heading}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.desktopView.subheading}</p>
        </header>

        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Monitor className="w-4 h-4 text-red-600" />
                <span>{t.desktopView.webModeTitle}</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t.desktopView.webModeDesc}
              </p>
              <p className="text-[11px] font-mono text-zinc-500">
                {t.desktopView.offlineInstallerNote}
              </p>
            </div>
            <a
              href="https://github.com/mk-tech/MK-AI-Pro/actions"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>{t.desktopView.downloadWindowsBtn}</span>
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs">
            <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 space-y-1">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                01. MK-AI-Setup.exe
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Single-file NSIS Windows 10/11 installer bundling Electron UI, FastAPI AI Engine, and isolated Python 3.11 embeddable runtime.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 space-y-1">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                02. Zero-CMD Auto Hardware Detection
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Probes NVIDIA GPU, VRAM, CUDA driver, RAM, and installs CUDA cu121, CPU, or Safe Compatibility PyTorch wheels automatically.
              </p>
            </div>
            <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 space-y-1">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                03. Private Local MK-AI-Data
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                Datasets, trained checkpoints, weights, exports, logs, and snapshots stay on disk with token-secured localhost FastAPI.
              </p>
            </div>
          </div>
        </section>

        {/* Model Browser vs Desktop Runtime Matrix */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          <h2 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.desktopView.compatibilityMatrixTitle}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-[11px] text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 text-start">Model</th>
                  <th className="py-2 text-start">Runtime</th>
                  <th className="py-2 text-end">Min RAM</th>
                  <th className="py-2 text-start ps-4">Requirement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {MODEL_CATALOG.slice(0, 10).map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                      {m.name}
                    </td>
                    <td className="py-2.5 font-mono text-zinc-600 dark:text-zinc-400">
                      {m.backendEngine === 'tfjs_browser' ? 'Browser TF.js' : 'Desktop Python'}
                    </td>
                    <td className="py-2.5 text-end font-mono">{m.minRamGb} GB</td>
                    <td className="py-2.5 ps-4 text-zinc-600 dark:text-zinc-400">
                      {m.gpuRequirement}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header & Top Action Bar */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-display font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {t.desktopView.heading}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.desktopView.subheading}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenWizard && (
            <button
              type="button"
              onClick={onOpenWizard}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t.desktopView.runWizardBtn}</span>
            </button>
          )}
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              void runAction('repair', async () => {
                const bridge = getDesktopBridge()!;
                await bridge.installOrRepairPythonEnv({
                  profile: hardware?.recommendedProfile ?? 'cpu',
                  repair: true,
                });
                await loadDesktopSnapshot(true);
                setNotice('Isolated Python environment audited and repaired.');
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>{t.desktopView.repairPythonBtn}</span>
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              void runAction('export', async () => {
                const bridge = getDesktopBridge()!;
                const out = await bridge.exportDiagnosticReport();
                setNotice(`Diagnostic report saved to ${out.savedPath}`);
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>{t.desktopView.exportDiagnosticsBtn}</span>
          </button>
        </div>
      </header>

      {notice && (
        <div className="p-3 rounded-lg border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/15 text-xs text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-400">
          {errorMsg}
        </div>
      )}

      {/* Top Status Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Runtime Card */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-red-600" />
              <span>{t.desktopView.runtimeCardTitle}</span>
            </h2>
            <span className="font-mono text-[11px] text-zinc-500">
              v{runtimeInfo?.appVersion ?? '—'} ({runtimeInfo?.installerType ?? 'online'})
            </span>
          </div>
          <div className="space-y-1.5 font-mono tabular-nums text-[11px] text-zinc-600 dark:text-zinc-400">
            <div>Python: {runtimeInfo?.pythonVersion || 'Not initialized'}</div>
            <div className="truncate">Executable: {runtimeInfo?.pythonExecutable || '—'}</div>
            <div>PyTorch: {hardware?.pytorchVersion || 'Not installed'}</div>
            <div>Ultralytics: {hardware?.ultralyticsVersion || 'Optional / Not installed'}</div>
            <div>ONNX Runtime: {hardware?.onnxruntimeVersion || 'Not installed'}</div>
          </div>
        </section>

        {/* Engine Supervisor Card */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-red-600" />
              <span>{t.desktopView.engineStatusCardTitle}</span>
            </h2>
            <span
              className={`font-semibold ${
                engineStatus?.healthy
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {engineStatus?.healthy ? t.desktopView.onlineStatus : t.desktopView.offlineStatus}
            </span>
          </div>
          <div className="space-y-1.5 font-mono tabular-nums text-[11px] text-zinc-600 dark:text-zinc-400">
            <div>
              Endpoint: {engineStatus?.bindHost ?? '127.0.0.1'}:{engineStatus?.port ?? '—'}
            </div>
            <div>
              PID: {engineStatus?.pid ?? '—'} · Restarts: {engineStatus?.restartCount ?? 0}
            </div>
            <div>
              Engine Version: {engineStatus?.version ?? runtimeInfo?.engineVersion ?? '—'}
            </div>
            <div>
              {t.desktopView.tokenSecurityLabel}:{' '}
              {(tokenStatus ?? engineStatus?.tokenStatus)?.protectionMode === 'os_dpapi_keychain'
                ? t.desktopView.tokenProtectedOs
                : t.desktopView.tokenProtectedLocal}
            </div>
            <div>
              {t.desktopView.tokenFingerprintLabel}:{' '}
              {(tokenStatus ?? engineStatus?.tokenStatus)?.fingerprintSha256Prefix ?? '—'} ·{' '}
              {t.desktopView.tokenRepairsLabel}:{' '}
              {(tokenStatus ?? engineStatus?.tokenStatus)?.repairCount ?? 0}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() =>
                void runAction('restart', async () => {
                  const eng = await getDesktopBridge()!.restartEngine();
                  setEngineStatus(eng);
                  await loadDesktopSnapshot(true);
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${busyAction === 'restart' ? 'animate-spin' : ''}`}
              />
              <span>{t.desktopView.restartEngineBtn}</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null || !engineStatus?.running}
              onClick={() =>
                void runAction('stop', async () => {
                  const eng = await getDesktopBridge()!.stopEngine();
                  setEngineStatus(eng);
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 disabled:opacity-45"
            >
              <Power className="w-3.5 h-3.5" />
              <span>{t.desktopView.stopEngineBtn}</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() =>
                void runAction('rotateToken', async () => {
                  const res = await getDesktopBridge()!.rotateEngineToken();
                  setTokenStatus(res.status);
                  const eng = await getDesktopBridge()!.getEngineStatus();
                  setEngineStatus(eng);
                  setNotice(
                    `${t.desktopView.tokenRotatedNotice} (${res.status.fingerprintSha256Prefix})`
                  );
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-45"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{t.desktopView.rotateTokenBtn}</span>
            </button>
          </div>
        </section>

        {/* Hardware & Device Card */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-red-600" />
              <span>{t.desktopView.hardwareCardTitle}</span>
            </h2>
            <span className="font-mono text-[11px] text-zinc-500">
              {hardware?.recommendedProfile ?? 'cpu'}
            </span>
          </div>
          <div className="space-y-1.5 font-mono tabular-nums text-[11px] text-zinc-600 dark:text-zinc-400">
            <div className="truncate">
              CPU: {hardware?.cpuModel ?? '—'} ({hardware?.logicalProcessors ?? 0} threads)
            </div>
            <div>
              RAM: {hardware?.availableRamGb ?? 0} / {hardware?.totalRamGb ?? 0} GB · Free Disk:{' '}
              {hardware?.freeDiskGb ?? 0} GB
            </div>
            <div>
              GPU:{' '}
              {hardware?.nvidiaGpuAvailable
                ? `${hardware.nvidiaGpuName} (${hardware.gpuMemoryTotalMb} MB)`
                : 'No NVIDIA GPU detected'}
            </div>
            <div>
              CUDA Driver: {hardware?.cudaDriverVersion ?? 'N/A'} · torch.cuda:{' '}
              {hardware?.pytorchCudaAvailable ? 'Enabled' : 'Inactive'}
            </div>
          </div>
          {config && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-zinc-500">
                {t.desktopView.deviceSelectorLabel}
              </span>
              <select
                value={config.selectedDevice}
                onChange={(e) =>
                  void runAction('device', async () => {
                    const next = await getDesktopBridge()!.updateConfig({
                      selectedDevice: e.target.value as DesktopConfig['selectedDevice'],
                    });
                    setConfig(next);
                  })
                }
                className="px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono text-[11px]"
              >
                <option value="auto">Auto (Prefer CUDA)</option>
                <option value="cpu">Force CPU</option>
                <option value="cuda:0" disabled={!hardware?.pytorchCudaAvailable}>
                  CUDA GPU (cuda:0)
                </option>
              </select>
            </div>
          )}
        </section>
      </div>

      {/* Local Storage & Lifecycle Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-red-600" />
              <span>{t.desktopView.storageCardTitle}</span>
            </h2>
            <span className="font-mono tabular-nums text-[11px] text-zinc-500">
              {formatBytes(storageUsage?.totalUsedBytes ?? 0)} used ·{' '}
              {formatBytes(storageUsage?.freeDiskBytes ?? 0)} free
            </span>
          </div>

          <p className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 break-all">
            {storageUsage?.storageRoot ?? runtimeInfo?.storageRoot ?? '—'}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono tabular-nums text-[11px]">
            {(Object.keys(storageUsage?.breakdownBytes ?? {}) as StorageSubdirName[]).map((sub) => (
              <div
                key={sub}
                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              >
                <div className="text-zinc-500 truncate">{sub}</div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatBytes(storageUsage?.breakdownBytes[sub] ?? 0)}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void getDesktopBridge()?.openStorageFolder()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t.desktopView.openFolderBtn}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void runAction('changeDir', async () => {
                  const chosen = await getDesktopBridge()!.selectStorageDirectory();
                  if (chosen) {
                    await loadDesktopSnapshot(false);
                    setNotice(`Storage folder switched to ${chosen}`);
                  }
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span>{t.desktopView.changeFolderBtn}</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() =>
                void runAction('clearCache', async () => {
                  const res = await getDesktopBridge()!.clearTempCache();
                  setStorageUsage(res.summary);
                  setNotice(`Cleared ${formatBytes(res.clearedBytes)} from cache and temp.`);
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t.desktopView.clearCacheBtn}</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() =>
                void runAction('backup', async () => {
                  const res = await getDesktopBridge()!.createBackupSnapshot('manual');
                  await loadDesktopSnapshot(false);
                  setNotice(`Backup snapshot created (${formatBytes(res.sizeBytes)}) at ${res.backupPath}`);
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>{t.desktopView.createBackupBtn}</span>
            </button>
          </div>
        </section>

        {/* Sync, Privacy & Updates Card */}
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 text-xs">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
            {t.desktopView.syncCardTitle}
          </h2>

          {config && (
            <div className="space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoStartEngine}
                  onChange={(e) =>
                    void runAction('autoStart', async () => {
                      const next = await getDesktopBridge()!.updateConfig({
                        autoStartEngine: e.target.checked,
                      });
                      setConfig(next);
                    })
                  }
                  className="accent-red-600"
                />
                <span>{t.desktopView.autoStartLabel}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.stopEngineOnExit}
                  onChange={(e) =>
                    void runAction('stopExit', async () => {
                      const next = await getDesktopBridge()!.updateConfig({
                        stopEngineOnExit: e.target.checked,
                      });
                      setConfig(next);
                    })
                  }
                  className="accent-red-600"
                />
                <span>{t.desktopView.stopOnExitLabel}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.cloudSyncConsentGranted}
                  onChange={(e) =>
                    void runAction('syncConsent', async () => {
                      const next = await getDesktopBridge()!.updateConfig({
                        cloudSyncConsentGranted: e.target.checked,
                      });
                      setConfig(next);
                    })
                  }
                  className="accent-red-600"
                />
                <span>{t.desktopView.cloudSyncConsentLabel}</span>
              </label>
            </div>
          )}

          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {t.desktopView.updatesCardTitle}
              </span>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() =>
                  void runAction('updates', async () => {
                    const rep = await getDesktopBridge()!.checkForUpdates();
                    setUpdateReport(rep);
                  })
                }
                className="px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {t.desktopView.checkUpdatesBtn}
              </button>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 font-mono tabular-nums text-[11px]">
              {(updateReport?.entries ?? []).map((entry) => (
                <div key={entry.component} className="py-1.5 flex items-center justify-between gap-2">
                  <span>{entry.component}</span>
                  <span className="text-zinc-500">
                    {entry.currentVersion} → {entry.latestVersion}{' '}
                    {entry.compatible ? '(OK)' : '(Incompatible)'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Hardware-to-Model Compatibility Matrix */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3 text-xs">
        <h2 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
          {t.desktopView.compatibilityMatrixTitle}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full tabular-nums">
            <thead>
              <tr className="text-[11px] text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 text-start">Model</th>
                <th className="py-2 text-start">Engine</th>
                <th className="py-2 text-end">Min RAM</th>
                <th className="py-2 text-start ps-4">Device</th>
                <th className="py-2 text-start">Status & Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {compatibilityList.map(({ spec, compat }) => (
                <tr key={spec.id}>
                  <td className="py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                    {spec.name}
                  </td>
                  <td className="py-2.5 font-mono text-zinc-500">{spec.backendEngine}</td>
                  <td className="py-2.5 text-end font-mono">{spec.minRamGb} GB</td>
                  <td className="py-2.5 ps-4 font-mono">{compat.recommendedDevice}</td>
                  <td className="py-2.5">
                    <span
                      className={`font-semibold me-2 ${
                        compat.severity === 'ok'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : compat.severity === 'warning'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {compat.severity === 'ok'
                        ? t.desktopView.compatibleLabel
                        : compat.severity === 'warning'
                        ? t.desktopView.warningLabel
                        : t.desktopView.blockedLabel}
                    </span>
                    <span className="text-zinc-500">
                      {(locale === 'ar' ? compat.warningsAr : compat.warningsEn)[0] || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Local Verified Model Weights & Rollback */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.desktopView.weightsManagerTitle}
          </h2>
          <span className="font-mono text-[11px] text-zinc-500">{localWeights.length}</span>
        </div>

        {localWeights.length === 0 ? (
          <p className="text-zinc-500">
            No cached desktop model weight artifacts in MK-AI-Data/model_weights yet. Weights download automatically with SHA-256 verification on first Python training run.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {localWeights.map((w) => (
              <div key={w.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {w.catalogModelId} · {w.filename}
                  </div>
                  <div className="font-mono text-[11px] text-zinc-500">
                    {formatBytes(w.sizeBytes)} · SHA-256: {w.sha256.slice(0, 16)}... · {w.license}
                  </div>
                </div>
                {w.previousVersionPath && (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(`rollback-${w.catalogModelId}`, async () => {
                        await getDesktopBridge()!.rollbackWeightArtifact(w.catalogModelId);
                        await loadDesktopSnapshot(false);
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t.desktopView.rollbackWeightBtn}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
