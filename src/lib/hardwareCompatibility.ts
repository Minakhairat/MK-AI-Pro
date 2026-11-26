import type {
  DesktopWeightRecord,
  HardwareReport,
  ModelHardwareCompatibility,
} from '../types/desktop';
import type { ModelCatalogSpec } from '../types/domain';

export function evaluateModelHardwareCompatibility(
  spec: ModelCatalogSpec,
  hardware: HardwareReport | null,
  desktopWeights: DesktopWeightRecord[] = []
): ModelHardwareCompatibility {
  const warningsEn: string[] = [];
  const warningsAr: string[] = [];
  const hasCachedWeight = desktopWeights.some((w) => w.catalogModelId === spec.id);
  const requiresDownload = Boolean(spec.pretrainedAvailable && !hasCachedWeight);

  if (spec.backendEngine === 'tfjs_browser') {
    if (hardware && hardware.totalRamGb > 0 && hardware.totalRamGb < spec.minRamGb) {
      warningsEn.push(
        `Recommended RAM is ${spec.minRamGb} GB; system reports ${hardware.totalRamGb} GB.`
      );
      warningsAr.push(
        `الذاكرة الموصى بها ${spec.minRamGb} جيجابايت؛ الجهاز يمتلك ${hardware.totalRamGb} جيجابايت.`
      );
      return {
        modelId: spec.id,
        compatible: true,
        severity: 'warning',
        recommendedDevice: 'browser_webgl',
        requiresDownload: false,
        warningsEn,
        warningsAr,
      };
    }
    return {
      modelId: spec.id,
      compatible: true,
      severity: 'ok',
      recommendedDevice: 'browser_webgl',
      requiresDownload: false,
      warningsEn,
      warningsAr,
    };
  }

  // Python FastAPI backend model
  if (!hardware) {
    warningsEn.push('Local Python hardware profile not detected yet. Install MK AI Desktop or connect Python worker.');
    warningsAr.push('لم يتم اكتشاف عتاد Python المحلي بعد. ثبّت MK AI Desktop أو صِل خادم Python.');
    return {
      modelId: spec.id,
      compatible: false,
      severity: 'warning',
      recommendedDevice: 'unsupported',
      requiresDownload,
      warningsEn,
      warningsAr,
    };
  }

  let blocked = false;
  let warning = false;

  if (!hardware.pytorchInstalled) {
    blocked = true;
    warningsEn.push('PyTorch is not installed in the isolated Python runtime yet.');
    warningsAr.push('مكتبة PyTorch غير مثبتة في بيئة بايثون المعزولة بعد.');
  }

  if (hardware.totalRamGb > 0 && hardware.totalRamGb < spec.minRamGb) {
    if (hardware.totalRamGb < Math.max(4, spec.minRamGb * 0.6)) {
      blocked = true;
      warningsEn.push(
        `Insufficient RAM (${hardware.totalRamGb} GB available; minimum ${spec.minRamGb} GB required).`
      );
      warningsAr.push(
        `الذاكرة غير كافية (${hardware.totalRamGb} جيجابايت متاحة؛ المطلوب ${spec.minRamGb} جيجابايت).`
      );
    } else {
      warning = true;
      warningsEn.push(
        `Tight RAM (${hardware.totalRamGb} GB vs ${spec.minRamGb} GB recommended); use small batch sizes (1-4).`
      );
      warningsAr.push(
        `الذاكرة محدودة (${hardware.totalRamGb} مقابل ${spec.minRamGb} جيجابايت الموصى بها)؛ استخدم Batch صغير (1-4).`
      );
    }
  }

  if (spec.tierStatus === 'external_gpu_required' && !hardware.nvidiaGpuAvailable) {
    blocked = true;
    warningsEn.push('Requires an NVIDIA CUDA GPU; cannot execute efficiently on CPU-only hardware.');
    warningsAr.push('يتطلب كارت شاشة NVIDIA CUDA؛ لا يُنصح بتشغيله على المعالج فقط.');
  } else if (!hardware.nvidiaGpuAvailable) {
    if (!spec.cpuCompatible) {
      blocked = true;
      warningsEn.push('No NVIDIA GPU detected and this architecture is not CPU-compatible.');
      warningsAr.push('لم يُكتشف كارت NVIDIA وهذا النموذج غير متوافق مع المعالج.');
    } else if (spec.minRamGb >= 6 || spec.modelSizeMb > 40) {
      warning = true;
      warningsEn.push('No NVIDIA GPU detected — CPU training will run slowly on this architecture.');
      warningsAr.push('لا يوجد كارت شاشة NVIDIA — التدريب على المعالج سيكون بطيئاً لهذه المعمارية.');
    }
  } else if (!hardware.pytorchCudaAvailable) {
    warning = true;
    warningsEn.push(
      'NVIDIA GPU present, but PyTorch CUDA is inactive. Repair Python environment with the NVIDIA GPU profile.'
    );
    warningsAr.push(
      'يوجد كارت NVIDIA لكن دعم PyTorch CUDA غير مفعل. أعد إصلاح البيئة بملف NVIDIA GPU.'
    );
  } else if (
    hardware.gpuMemoryTotalMb > 0 &&
    spec.minRamGb >= 12 &&
    hardware.gpuMemoryTotalMb < 4096
  ) {
    warning = true;
    warningsEn.push(
      `GPU VRAM (${Math.round(hardware.gpuMemoryTotalMb / 1024)} GB) may require batch size 1–2.`
    );
    warningsAr.push(
      `ذاكرة كارت الشاشة (${Math.round(hardware.gpuMemoryTotalMb / 1024)} جيجابايت) قد تتطلب تقليل حجم الدفعة إلى 1–2.`
    );
  }

  if (spec.requiredPythonPackages.includes('ultralytics') && !hardware.ultralyticsInstalled) {
    warning = true;
    warningsEn.push('Ultralytics package will be installed on-demand or via Dependency Repair.');
    warningsAr.push('مكتبة Ultralytics ستُثبت عند الحاجة أو عبر زر إصلاح المكتبات.');
  }

  if (requiresDownload) {
    warningsEn.push('Pretrained weights are not cached locally yet and will download on first run.');
    warningsAr.push('الأوزان المسبقة غير محملة محلياً بعد وسيتم تنزيلها عند أول تشغيل.');
  }

  const recommendedDevice: ModelHardwareCompatibility['recommendedDevice'] = blocked
    ? 'unsupported'
    : hardware.nvidiaGpuAvailable && hardware.pytorchCudaAvailable
    ? 'cuda'
    : 'cpu';

  return {
    modelId: spec.id,
    compatible: !blocked,
    severity: blocked ? 'blocked' : warning ? 'warning' : 'ok',
    recommendedDevice,
    requiresDownload,
    warningsEn,
    warningsAr,
  };
}
