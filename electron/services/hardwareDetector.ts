import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import type { ExecutionProfile, HardwareReport } from '../../src/types/desktop.ts';

const execFileAsync = promisify(execFile);

export interface NvidiaProbeResult {
  available: boolean;
  gpuName: string | null;
  memoryTotalMb: number;
  memoryFreeMb: number;
  driverVersion: string | null;
  cudaDriverVersion: string | null;
}

export interface PythonPackageProbeResult {
  pytorchInstalled: boolean;
  pytorchVersion: string | null;
  pytorchCudaAvailable: boolean;
  torchvisionVersion: string | null;
  ultralyticsInstalled: boolean;
  ultralyticsVersion: string | null;
  timmInstalled: boolean;
  timmVersion: string | null;
  transformersInstalled: boolean;
  onnxruntimeInstalled: boolean;
  onnxruntimeVersion: string | null;
}

export function selectExecutionProfile(input: {
  nvidiaGpuAvailable: boolean;
  driverCompatible: boolean;
  pytorchInstalled: boolean;
  pytorchCudaAvailable: boolean;
  totalRamGb: number;
  probeFailed?: boolean;
}): ExecutionProfile {
  if (input.probeFailed || input.totalRamGb < 4) {
    return 'safe_compatibility';
  }
  if (input.nvidiaGpuAvailable && input.driverCompatible) {
    if (!input.pytorchInstalled || input.pytorchCudaAvailable) {
      return 'nvidia_gpu';
    }
  }
  return 'cpu';
}

export function parseNvidiaSmiCsv(stdout: string): NvidiaProbeResult {
  const firstLine = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!firstLine) {
    return {
      available: false,
      gpuName: null,
      memoryTotalMb: 0,
      memoryFreeMb: 0,
      driverVersion: null,
      cudaDriverVersion: null,
    };
  }
  const parts = firstLine.split(',').map((p) => p.trim());
  const gpuName = parts[0] || null;
  const memoryTotalMb = Number.parseInt(parts[1] || '0', 10) || 0;
  const memoryFreeMb = Number.parseInt(parts[2] || '0', 10) || 0;
  const driverVersion = parts[3] || null;
  return {
    available: Boolean(gpuName),
    gpuName,
    memoryTotalMb,
    memoryFreeMb,
    driverVersion,
    cudaDriverVersion: null,
  };
}

export class HardwareDetector {
  private lastReport: HardwareReport | null = null;

  async probeNvidiaSmi(): Promise<NvidiaProbeResult> {
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        [
          '--query-gpu=name,memory.total,memory.free,driver_version',
          '--format=csv,noheader,nounits',
        ],
        { timeout: 3500, windowsHide: true }
      );
      const parsed = parseNvidiaSmiCsv(stdout);
      if (!parsed.available) return parsed;

      // Also parse CUDA Version from standard nvidia-smi header if available
      try {
        const headerOut = await execFileAsync('nvidia-smi', [], {
          timeout: 3000,
          windowsHide: true,
        });
        const match = headerOut.stdout.match(/CUDA Version:\s*([0-9]+\.[0-9]+)/i);
        if (match) parsed.cudaDriverVersion = match[1];
      } catch {
        // Non-fatal
      }
      return parsed;
    } catch {
      return {
        available: false,
        gpuName: null,
        memoryTotalMb: 0,
        memoryFreeMb: 0,
        driverVersion: null,
        cudaDriverVersion: null,
      };
    }
  }

  async probePythonPackages(pythonExe: string | null): Promise<PythonPackageProbeResult> {
    const empty: PythonPackageProbeResult = {
      pytorchInstalled: false,
      pytorchVersion: null,
      pytorchCudaAvailable: false,
      torchvisionVersion: null,
      ultralyticsInstalled: false,
      ultralyticsVersion: null,
      timmInstalled: false,
      timmVersion: null,
      transformersInstalled: false,
      onnxruntimeInstalled: false,
      onnxruntimeVersion: null,
    };
    if (!pythonExe || !fs.existsSync(pythonExe)) {
      return empty;
    }

    const script = [
      'import json',
      'out = {}',
      'for mod in ["torch","torchvision","ultralytics","timm","transformers","onnxruntime"]:',
      '  try:',
      '    m = __import__(mod)',
      '    out[mod] = str(getattr(m, "__version__", "installed"))',
      '  except Exception:',
      '    out[mod] = None',
      'cuda_ok = False',
      'try:',
      '  import torch',
      '  cuda_ok = bool(torch.cuda.is_available())',
      'except Exception:',
      '  cuda_ok = False',
      'out["torch_cuda"] = cuda_ok',
      'print(json.dumps(out))',
    ].join('\n');

    try {
      const { stdout } = await execFileAsync(pythonExe, ['-c', script], {
        timeout: 12000,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONNOUSERSITE: '1',
          PYTHONPATH: '',
        },
      });
      const data = JSON.parse(stdout.trim()) as Record<string, string | boolean | null>;
      return {
        pytorchInstalled: Boolean(data.torch),
        pytorchVersion: typeof data.torch === 'string' ? data.torch : null,
        pytorchCudaAvailable: Boolean(data.torch_cuda),
        torchvisionVersion: typeof data.torchvision === 'string' ? data.torchvision : null,
        ultralyticsInstalled: Boolean(data.ultralytics),
        ultralyticsVersion: typeof data.ultralytics === 'string' ? data.ultralytics : null,
        timmInstalled: Boolean(data.timm),
        timmVersion: typeof data.timm === 'string' ? data.timm : null,
        transformersInstalled: Boolean(data.transformers),
        onnxruntimeInstalled: Boolean(data.onnxruntime),
        onnxruntimeVersion: typeof data.onnxruntime === 'string' ? data.onnxruntime : null,
      };
    } catch {
      return empty;
    }
  }

  async detect(params: {
    pythonExe: string | null;
    storageRoot: string;
    forceRefresh?: boolean;
  }): Promise<HardwareReport> {
    if (this.lastReport && !params.forceRefresh) {
      return this.lastReport;
    }

    const cpus = os.cpus();
    const totalRamGb = Number((os.totalmem() / 1024 ** 3).toFixed(2));
    const availableRamGb = Number((os.freemem() / 1024 ** 3).toFixed(2));
    let freeDiskGb = 0;
    try {
      const st = fs.statfsSync(params.storageRoot);
      freeDiskGb = Number(((Number(st.bavail) * Number(st.bsize)) / 1024 ** 3).toFixed(2));
    } catch {
      freeDiskGb = 0;
    }

    const [nvidia, pyPkgs] = await Promise.all([
      this.probeNvidiaSmi(),
      this.probePythonPackages(params.pythonExe),
    ]);

    const warnings: string[] = [];
    if (totalRamGb < 8) {
      warnings.push(
        `System RAM (${totalRamGb} GB) is below recommended 8 GB for large PyTorch/YOLO models.`
      );
    }
    if (freeDiskGb > 0 && freeDiskGb < 8) {
      warnings.push(`Low free disk space (${freeDiskGb} GB remaining) at ${params.storageRoot}.`);
    }
    if (!nvidia.available) {
      warnings.push('No NVIDIA GPU detected via nvidia-smi. Heavy Vision Transformers will run slowly on CPU.');
    } else if (pyPkgs.pytorchInstalled && !pyPkgs.pytorchCudaAvailable) {
      warnings.push(
        'NVIDIA GPU detected, but the installed PyTorch build reports torch.cuda.is_available() == False. Repair environment with NVIDIA GPU profile.'
      );
    }

    const cudaMajor = nvidia.cudaDriverVersion
      ? Number.parseFloat(nvidia.cudaDriverVersion)
      : 0;
    const driverCompatible = nvidia.available && (cudaMajor === 0 || cudaMajor >= 11.8);
    if (nvidia.available && cudaMajor > 0 && cudaMajor < 11.8) {
      warnings.push(
        `NVIDIA driver reports CUDA ${nvidia.cudaDriverVersion}; CUDA 11.8+ is required for accelerated PyTorch.`
      );
    }

    const recommendedProfile = selectExecutionProfile({
      nvidiaGpuAvailable: nvidia.available,
      driverCompatible,
      pytorchInstalled: pyPkgs.pytorchInstalled,
      pytorchCudaAvailable: pyPkgs.pytorchCudaAvailable,
      totalRamGb,
    });

    const report: HardwareReport = {
      detectedAt: new Date().toISOString(),
      osPlatform: process.platform,
      osVersion: `${os.type()} ${os.release()}`,
      cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
      cpuArch: os.arch(),
      physicalCores: Math.max(1, Math.floor(cpus.length / 2) || cpus.length),
      logicalProcessors: Math.max(1, cpus.length),
      totalRamGb,
      availableRamGb,
      freeDiskGb,
      nvidiaGpuAvailable: nvidia.available,
      nvidiaGpuName: nvidia.gpuName,
      gpuMemoryTotalMb: nvidia.memoryTotalMb,
      gpuMemoryFreeMb: nvidia.memoryFreeMb,
      nvidiaDriverVersion: nvidia.driverVersion,
      cudaDriverVersion: nvidia.cudaDriverVersion,
      pytorchInstalled: pyPkgs.pytorchInstalled,
      pytorchVersion: pyPkgs.pytorchVersion,
      pytorchCudaAvailable: pyPkgs.pytorchCudaAvailable,
      torchvisionVersion: pyPkgs.torchvisionVersion,
      ultralyticsInstalled: pyPkgs.ultralyticsInstalled,
      ultralyticsVersion: pyPkgs.ultralyticsVersion,
      timmInstalled: pyPkgs.timmInstalled,
      timmVersion: pyPkgs.timmVersion,
      transformersInstalled: pyPkgs.transformersInstalled,
      onnxruntimeInstalled: pyPkgs.onnxruntimeInstalled,
      onnxruntimeVersion: pyPkgs.onnxruntimeVersion,
      recommendedProfile,
      warnings,
    };

    this.lastReport = report;
    return report;
  }
}
