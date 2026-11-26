import type {
  ExecutionProfile,
  SetupStepId,
  SetupWizardState,
  SetupWizardStepResult,
} from '../../src/types/desktop.ts';
import type { DependencyManager } from './dependencyManager.ts';
import type { LocalEngineManager } from './engineManager.ts';
import type { HardwareDetector } from './hardwareDetector.ts';
import type { PythonRuntimeManager } from './pythonRuntimeManager.ts';
import type { DesktopStorageManager } from './storageManager.ts';

function createInitialSteps(): SetupWizardStepResult[] {
  return [
    {
      id: 'sys_req',
      order: 1,
      titleEn: 'System Requirements Check',
      titleAr: 'فحص متطلبات النظام',
      status: 'pending',
      detail: 'Waiting to inspect OS, RAM, CPU, and disk space...',
      recoverable: true,
      autoRepairAvailable: false,
      durationMs: 0,
    },
    {
      id: 'python_runtime',
      order: 2,
      titleEn: 'Python Runtime Verification',
      titleAr: 'التحقق من بيئة بايثون المعزولة',
      status: 'pending',
      detail: 'Waiting to verify isolated Python runtime...',
      recoverable: true,
      autoRepairAvailable: true,
      durationMs: 0,
    },
    {
      id: 'ai_deps',
      order: 3,
      titleEn: 'AI Dependency Verification',
      titleAr: 'التحقق من مكتبات الذكاء الاصطناعي',
      status: 'pending',
      detail: 'Waiting to audit pinned Python packages...',
      recoverable: true,
      autoRepairAvailable: true,
      durationMs: 0,
    },
    {
      id: 'hardware_detect',
      order: 4,
      titleEn: 'CPU / GPU Detection',
      titleAr: 'اكتشاف المعالج وكارت الشاشة',
      status: 'pending',
      detail: 'Waiting for CPU, RAM, NVIDIA GPU, and CUDA driver probe...',
      recoverable: true,
      autoRepairAvailable: false,
      durationMs: 0,
    },
    {
      id: 'pytorch_verify',
      order: 5,
      titleEn: 'PyTorch Verification',
      titleAr: 'اختبار نواة PyTorch الفعلي',
      status: 'pending',
      detail: 'Waiting to execute live tensor forward/backward probe...',
      recoverable: true,
      autoRepairAvailable: true,
      durationMs: 0,
    },
    {
      id: 'yolo_verify',
      order: 6,
      titleEn: 'YOLO Runtime Verification',
      titleAr: 'التحقق من جاهزية Ultralytics YOLO',
      status: 'pending',
      detail: 'Waiting to check Ultralytics YOLO runtime...',
      recoverable: true,
      autoRepairAvailable: true,
      durationMs: 0,
    },
    {
      id: 'storage_init',
      order: 7,
      titleEn: 'Local Storage Initialization',
      titleAr: 'تهيئة مجلدات التخزين المحلي',
      status: 'pending',
      detail: 'Waiting to prepare MK-AI-Data workspace folders...',
      recoverable: true,
      autoRepairAvailable: true,
      durationMs: 0,
    },
    {
      id: 'fastapi_start',
      order: 8,
      titleEn: 'FastAPI Service Startup',
      titleAr: 'تشغيل محرك FastAPI المحلي',
      status: 'pending',
      detail: 'Waiting to start authenticated local FastAPI worker...',
      recoverable: true,
      autoRepairAvailable: true,
      durationMs: 0,
    },
    {
      id: 'engine_e2e',
      order: 9,
      titleEn: 'End-to-End AI Engine Connection Test',
      titleAr: 'اختبار الاتصال الشامل بمحرك الذكاء الاصطناعي',
      status: 'pending',
      detail: 'Waiting to run authenticated /capabilities and tensor verification...',
      recoverable: true,
      autoRepairAvailable: true,
      durationMs: 0,
    },
    {
      id: 'readiness_report',
      order: 10,
      titleEn: 'Final System Readiness Report',
      titleAr: 'تقرير جاهزية النظام النهائي',
      status: 'pending',
      detail: 'Waiting to compile verified environment report...',
      recoverable: true,
      autoRepairAvailable: false,
      durationMs: 0,
    },
  ];
}

export class SetupWizardRunner {
  private storage: DesktopStorageManager;
  private runtime: PythonRuntimeManager;
  private hardware: HardwareDetector;
  private deps: DependencyManager;
  private engine: LocalEngineManager;
  private state: SetupWizardState = {
    running: false,
    completed: false,
    overallReady: false,
    selectedProfile: 'cpu',
    steps: createInitialSteps(),
    lastRunAt: null,
  };

  constructor(params: {
    storage: DesktopStorageManager;
    runtime: PythonRuntimeManager;
    hardware: HardwareDetector;
    deps: DependencyManager;
    engine: LocalEngineManager;
  }) {
    this.storage = params.storage;
    this.runtime = params.runtime;
    this.hardware = params.hardware;
    this.deps = params.deps;
    this.engine = params.engine;
  }

  getState(): SetupWizardState {
    return {
      ...this.state,
      steps: this.state.steps.map((s) => ({ ...s })),
    };
  }

  private updateStep(
    id: SetupStepId,
    patch: Partial<SetupWizardStepResult>,
    onProgress?: (state: SetupWizardState) => void
  ): void {
    this.state.steps = this.state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    onProgress?.(this.getState());
  }

  async run(
    opts: { profile?: ExecutionProfile; autoInstallIfMissing?: boolean } = {},
    onProgress?: (state: SetupWizardState) => void
  ): Promise<SetupWizardState> {
    this.state = {
      running: true,
      completed: false,
      overallReady: false,
      selectedProfile: opts.profile ?? 'cpu',
      steps: createInitialSteps(),
      lastRunAt: null,
    };
    onProgress?.(this.getState());

    const runStep = async <T>(
      id: SetupStepId,
      fn: () => Promise<{ status: 'passed' | 'warning'; detail: string; value?: T }>
    ): Promise<{ ok: boolean; value?: T }> => {
      const t0 = Date.now();
      this.updateStep(id, { status: 'running' }, onProgress);
      try {
        const res = await fn();
        this.updateStep(
          id,
          {
            status: res.status,
            detail: res.detail,
            durationMs: Date.now() - t0,
            failureReason: undefined,
          },
          onProgress
        );
        return { ok: true, value: res.value };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.updateStep(
          id,
          {
            status: 'failed',
            detail: msg,
            failureReason: msg,
            durationMs: Date.now() - t0,
          },
          onProgress
        );
        return { ok: false };
      }
    };

    // Step 1: System Requirements
    const sysRes = await runStep('sys_req', async () => {
      const preHw = await this.hardware.detect({
        pythonExe: null,
        storageRoot: this.storage.getStorageRoot(),
        forceRefresh: true,
      });
      if (preHw.totalRamGb < 3.5) {
        throw new Error(`Available RAM (${preHw.totalRamGb} GB) is below minimum 4 GB threshold.`);
      }
      const warn = preHw.totalRamGb < 8 || (preHw.freeDiskGb > 0 && preHw.freeDiskGb < 6);
      return {
        status: warn ? 'warning' : 'passed',
        detail: `${preHw.osVersion} · ${preHw.cpuModel} (${preHw.logicalProcessors} threads) · ${preHw.totalRamGb} GB RAM · ${preHw.freeDiskGb} GB free disk`,
        value: preHw,
      };
    });

    const activeProfile: ExecutionProfile =
      opts.profile ?? sysRes.value?.recommendedProfile ?? 'cpu';
    this.state.selectedProfile = activeProfile;

    // Step 2: Python Runtime Verification
    const pyRes = await runStep('python_runtime', async () => {
      let probe = await this.runtime.inspectRuntime();
      if (!probe.ready && opts.autoInstallIfMissing) {
        probe = await this.runtime.ensureIsolatedRuntime();
      }
      if (!probe.ready || !probe.pythonExecutable) {
        this.updateStep('python_runtime', {
          userActionEn: 'Click "Install / Repair Python Environment" to download the isolated Python runtime.',
          userActionAr: 'اضغط على "إصلاح / تثبيت بيئة بايثون" لتحميل بيئة بايثون المعزولة تلقائيًا.',
        });
        throw new Error('Isolated embedded Python runtime is not initialized yet.');
      }
      return {
        status: 'passed',
        detail: `Python ${probe.pythonVersion} (${probe.source}) at ${probe.pythonExecutable}`,
        value: probe,
      };
    });

    // Step 3: AI Dependency Verification
    const depsRes = await runStep('ai_deps', async () => {
      let audit = await this.deps.auditEnvironment(activeProfile);
      if (audit.issues.length > 0 && opts.autoInstallIfMissing && pyRes.ok) {
        await this.deps.installOrRepair({ profile: activeProfile });
        audit = await this.deps.auditEnvironment(activeProfile);
      }
      if (!audit.pythonReady || audit.issues.length > 0) {
        this.updateStep('ai_deps', {
          userActionEn: 'Run automatic dependency repair to install pinned PyTorch & FastAPI wheels.',
          userActionAr: 'شغّل الإصلاح التلقائي للمكتبات لتثبيت حزم PyTorch و FastAPI المتوافقة.',
        });
        throw new Error(audit.issues[0] || 'Required Python AI packages are missing.');
      }
      const installedCount = audit.packages.filter((p) => p.status === 'ok').length;
      return {
        status: 'passed',
        detail: `${installedCount}/${audit.packages.length} packages verified for profile "${activeProfile}".`,
      };
    });

    // Step 4: Hardware & GPU/CUDA Detection
    const hwRes = await runStep('hardware_detect', async () => {
      const hw = await this.hardware.detect({
        pythonExe: pyRes.value?.pythonExecutable ?? null,
        storageRoot: this.storage.getStorageRoot(),
        forceRefresh: true,
      });
      const gpuText = hw.nvidiaGpuAvailable
        ? `${hw.nvidiaGpuName} (${hw.gpuMemoryTotalMb} MB VRAM · Driver ${hw.nvidiaDriverVersion || 'n/a'} · torch.cuda=${hw.pytorchCudaAvailable})`
        : 'No NVIDIA GPU detected — CPU execution mode active';
      return {
        status: hw.nvidiaGpuAvailable && !hw.pytorchCudaAvailable ? 'warning' : 'passed',
        detail: `${gpuText} · Profile: ${hw.recommendedProfile}`,
        value: hw,
      };
    });

    // Step 5: PyTorch Verification (real tensor op)
    const torchOk = hwRes.value?.pytorchInstalled ?? false;
    if (!torchOk) {
      this.updateStep(
        'pytorch_verify',
        {
          status: 'failed',
          detail: 'PyTorch is not installed in the isolated Python runtime.',
          failureReason: 'Missing torch module',
          userActionEn: 'Install dependencies for CPU or NVIDIA GPU profile.',
          userActionAr: 'قم بتثبيت حزم PyTorch للوضع المناسب لجهازك.',
        },
        onProgress
      );
    }

    // Step 6: YOLO Runtime Verification
    const yoloInstalled = hwRes.value?.ultralyticsInstalled ?? false;
    this.updateStep(
      'yolo_verify',
      yoloInstalled
        ? {
            status: 'passed',
            detail: `Ultralytics YOLO ${hwRes.value?.ultralyticsVersion || ''} ready`,
          }
        : {
            status: 'warning',
            detail: 'Ultralytics YOLO optional extra is not installed yet (installs on-demand when selecting YOLO models).',
            userActionEn: 'Optional: click Install YOLO Extra or select a YOLO model in Training Studio.',
            userActionAr: 'اختياري: يُثبت تلقائيًا عند اختيار نماذج YOLO في استوديو التدريب.',
          },
      onProgress
    );

    // Step 7: Local Storage Initialization
    await runStep('storage_init', async () => {
      const ensured = this.storage.ensureStructure();
      return {
        status: 'passed',
        detail: `MK-AI-Data initialized at ${ensured.root} (${Object.keys(ensured.directories).length} subdirectories)`,
      };
    });

    // Step 8: FastAPI Service Startup
    const engineRes = await runStep('fastapi_start', async () => {
      const st = await this.engine.start();
      if (!st.healthy || !st.port || !st.tokenProtected) {
        throw new Error(
          st.lastError || 'FastAPI local engine did not pass authenticated health verification.'
        );
      }
      const fp = st.tokenStatus?.fingerprintSha256Prefix || 'protected';
      return {
        status: 'passed',
        detail: `Local FastAPI Engine listening on 127.0.0.1:${st.port} (PID ${st.pid}, ${fp})`,
        value: st,
      };
    });

    // Step 9: End-to-End Engine + PyTorch Tensor Probe
    if (engineRes.ok && torchOk) {
      await runStep('pytorch_verify', async () => {
        const probe = await this.engine.requestJson<{
          passed: boolean;
          device: string;
          torch_version: string;
          duration_ms: number;
        }>('/diagnostics/verify', { method: 'POST', body: { check: 'pytorch' } });
        if (!probe.passed) throw new Error('PyTorch gradient verification returned false.');
        return {
          status: 'passed',
          detail: `PyTorch ${probe.torch_version} backward pass verified on ${probe.device} (${probe.duration_ms}ms)`,
        };
      });

      await runStep('engine_e2e', async () => {
        const caps = await this.engine.requestJson<{ supported_architectures?: string[] }>(
          '/capabilities'
        );
        const count = Array.isArray(caps.supported_architectures)
          ? caps.supported_architectures.length
          : 0;
        return {
          status: 'passed',
          detail: `Authenticated /capabilities confirmed ${count} ready local architectures.`,
        };
      });
    } else {
      this.updateStep(
        'engine_e2e',
        {
          status: 'failed',
          detail: 'Skipped end-to-end check because FastAPI Engine or PyTorch is unavailable.',
          failureReason: 'Engine or PyTorch prerequisite not ready',
        },
        onProgress
      );
    }

    // Step 10: Final Readiness Report
    const criticalFailed = this.state.steps.some(
      (s) =>
        s.id !== 'readiness_report' &&
        s.id !== 'yolo_verify' &&
        s.status === 'failed'
    );
    const overallReady = !criticalFailed && Boolean(engineRes.ok) && Boolean(depsRes.ok);

    this.updateStep(
      'readiness_report',
      {
        status: overallReady ? 'passed' : 'warning',
        detail: overallReady
          ? `All critical checks passed. Local Python AI training ready (${activeProfile}).`
          : 'Desktop UI & Browser TF.js are ready; repair the failed Python step above to enable local Python/GPU training.',
      },
      onProgress
    );

    this.state.running = false;
    this.state.completed = true;
    this.state.overallReady = overallReady;
    this.state.lastRunAt = new Date().toISOString();
    if (overallReady) {
      this.storage.updateConfig({ firstLaunchCompleted: true });
    }
    onProgress?.(this.getState());
    return this.getState();
  }
}
