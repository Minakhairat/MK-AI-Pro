import type {
  AnyTaskType,
  ModelRecommendation,
  OptimizationPriority,
  PythonWorkerCapabilities,
  TargetDeviceType,
} from '../types/domain.ts';
import { checkWorkerCompatibility, MODEL_CATALOG } from './modelRegistry.ts';

export interface RecommendationQuery {
  taskType: AnyTaskType;
  sampleCount: number;
  classCount: number;
  minResolution?: number;
  imbalanceRatio?: number | null;
  targetDevice: TargetDeviceType;
  priority: OptimizationPriority;
  webglAvailable?: boolean;
  workerCapabilities?: PythonWorkerCapabilities | null;
}

export function recommendModelsForProject(query: RecommendationQuery): ModelRecommendation[] {
  const candidates = MODEL_CATALOG.filter(
    (spec) => spec.supportedTasks.includes(query.taskType) && spec.capabilities.training
  );

  const scored: ModelRecommendation[] = candidates.map((spec) => {
    const reasonsEn: string[] = [];
    const reasonsAr: string[] = [];
    let score = 50;
    let compatible = true;
    let blockerReason: string | undefined;

    if (spec.backendEngine === 'python_fastapi') {
      const workerCheck = checkWorkerCompatibility(spec, query.workerCapabilities);
      if (!workerCheck.compatible) {
        compatible = false;
        blockerReason = workerCheck.reason;
        score -= 100;
      } else {
        score += 12;
        reasonsEn.push('External Python AI Worker verified and online.');
        reasonsAr.push('خادم الذكاء الاصطناعي الخارجي متصل وجاهز.');
      }
    } else {
      reasonsEn.push('Trains 100% locally in browser with zero external GPU cost.');
      reasonsAr.push('يتدرب محلياً بالكامل في المتصفح دون تكلفة خادم خارجي.');
    }

    // Target device compatibility
    if (query.targetDevice === 'browser' || query.targetDevice === 'mobile_pwa') {
      if (spec.browserCompatible && spec.mobileCompatible) {
        score += 30;
        reasonsEn.push('Runs natively on browser & offline mobile PWA.');
        reasonsAr.push('يعمل مباشرة في المتصفح وتطبيقات PWA المحمولة.');
      } else {
        compatible = false;
        blockerReason = blockerReason ?? 'Requires desktop/server GPU runtime, incompatible with pure browser PWA.';
        score -= 80;
      }
    } else if (query.targetDevice === 'desktop_gpu') {
      if (spec.backendEngine === 'python_fastapi') {
        score += 20;
      }
    }

    // Dataset size & Transfer Learning bias
    const isSmallDataset = query.sampleCount < 250;
    const isMediumDataset = query.sampleCount >= 250 && query.sampleCount < 1500;
    if (isSmallDataset && spec.pretrainedAvailable) {
      score += 25;
      reasonsEn.push(
        `Small dataset (${query.sampleCount} images): pretrained transfer learning prevents overfitting.`
      );
      reasonsAr.push(
        `حجم البيانات صغير (${query.sampleCount} صورة): التعلم بالنقل المُدرّب مسبقاً يمنع فرط التخصيص.`
      );
    } else if (!spec.pretrainedAvailable && isSmallDataset) {
      score -= 12;
      reasonsEn.push('Training from scratch needs more samples than transfer learning.');
      reasonsAr.push('التدريب من الصفر يحتاج عينات أكثر مقارنة بالتعلم بالنقل.');
    }

    // Priority alignment
    if (query.priority === 'small_size') {
      if (spec.modelSizeMb <= 6) score += 22;
      else if (spec.modelSizeMb > 50) score -= 20;
    } else if (query.priority === 'speed') {
      if (spec.parameterCountNum <= 3_000_000) score += 20;
      else if (spec.parameterCountNum > 30_000_000) score -= 18;
    } else if (query.priority === 'accuracy') {
      if (spec.pretrainedAvailable) score += 16;
      if (spec.parameterCountNum >= 1_300_000 && spec.parameterCountNum <= 35_000_000) score += 12;
    } else {
      // balanced
      if (spec.pretrainedAvailable && spec.modelSizeMb <= 25) score += 18;
    }

    // Hardware WebGL consideration
    if (query.webglAvailable === false && spec.backendEngine === 'tfjs_browser') {
      if (spec.modelSizeMb <= 6) {
        score += 10;
        reasonsEn.push('Compact enough for CPU-only browser fallback.');
        reasonsAr.push('خفيف بما يكفي للعمل على المعالج المركزي في حال غياب WebGL.');
      } else {
        score -= 10;
      }
    }

    if ((query.imbalanceRatio ?? 1) > 4) {
      reasonsEn.push('High class imbalance detected: use cosine LR + balanced splits.');
      reasonsAr.push('تباين عالٍ بين الفئات: يُنصح باستخدام جدولة Cosine وتوازن العينات.');
    }

    // Hyperparameter recommendation tuned for dataset size & architecture
    const fineTuningStrategy = !spec.pretrainedAvailable
      ? 'full_finetune'
      : isSmallDataset
      ? 'frozen_head'
      : isMediumDataset && spec.supportedStrategies.includes('partial_finetune')
      ? 'partial_finetune'
      : spec.supportedStrategies[0] ?? 'frozen_head';

    const learningRate =
      fineTuningStrategy === 'frozen_head'
        ? 0.001
        : fineTuningStrategy === 'partial_finetune'
        ? 0.00025
        : spec.backendEngine === 'tfjs_browser' && !spec.pretrainedAvailable
        ? 0.0012
        : 0.0001;

    const batchSize =
      query.sampleCount < 40 ? 4 : query.sampleCount < 160 ? 8 : spec.modelSizeMb > 30 ? 8 : 16;

    const epochs =
      fineTuningStrategy === 'frozen_head'
        ? 12
        : query.taskType === 'object_detection'
        ? 20
        : 16;

    const latencyTier: ModelRecommendation['latencyTier'] =
      spec.modelSizeMb <= 3
        ? 'ultra_fast'
        : spec.modelSizeMb <= 20
        ? 'fast'
        : spec.modelSizeMb <= 100
        ? 'medium'
        : 'heavy';

    return {
      spec,
      rank: 0,
      score,
      compatible,
      blockerReason,
      reasonsEn,
      reasonsAr,
      estimatedRamGb: spec.minRamGb,
      latencyTier,
      recommendedConfig: {
        fineTuningStrategy,
        learningRate,
        batchSize,
        epochs,
        inputSize: spec.recommendedInputSize,
        scheduler: spec.pretrainedAvailable ? 'cosine' : 'none',
        weightDecay: spec.pretrainedAvailable ? 0.0001 : 0.0005,
      },
    };
  });

  scored.sort((a, b) => {
    if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
    return b.score - a.score;
  });

  return scored.slice(0, 4).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}
