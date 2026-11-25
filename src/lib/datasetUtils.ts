import type {
  AugmentationConfig,
  BoundingBox,
  Dataset,
  DatasetItem,
  DatasetQualityReport,
  DatasetSplit,
  V1TaskType,
} from '../types/domain';

export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const DEFAULT_AUGMENTATION_CONFIG: AugmentationConfig = {
  rotateDeg: 0,
  flipHorizontal: false,
  flipVertical: false,
  brightnessDelta: 0,
  contrastDelta: 0,
  noiseLevel: 0,
  blurRadius: 0,
  resizeWidth: 640,
  resizeHeight: 640,
  applyOnlyToTrain: true,
};

export const CLASS_PALETTE = [
  '#DC2626',
  '#2563EB',
  '#16A34A',
  '#D97706',
  '#9333EA',
  '#0891B2',
  '#DB2777',
  '#4F46E5',
  '#65A30D',
  '#EA580C',
];

export function getClassColor(className: string, classes: string[]): string {
  const idx = Math.max(0, classes.indexOf(className));
  return CLASS_PALETTE[idx % CLASS_PALETTE.length];
}

export async function computeBlobSha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes real image dimensions and Laplacian variance sharpness score on Canvas.
 */
export async function analyzeImageBlob(blob: Blob): Promise<{
  width: number;
  height: number;
  blurScore: number;
  sha256: string;
}> {
  const sha256 = await computeBlobSha256(blob);
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid or corrupted image file.'));
      el.src = url;
    });

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    const maxSample = 192;
    const scale = Math.min(1, maxSample / Math.max(width, height));
    const sw = Math.max(8, Math.round(width * scale));
    const sh = Math.max(8, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    let blurScore = 100;

    if (ctx) {
      ctx.drawImage(img, 0, 0, sw, sh);
      const { data } = ctx.getImageData(0, 0, sw, sh);
      const gray = new Float32Array(sw * sh);
      for (let i = 0; i < sw * sh; i++) {
        const idx = i * 4;
        gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }

      // 4-neighbor discrete Laplacian variance
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let y = 1; y < sh - 1; y++) {
        for (let x = 1; x < sw - 1; x++) {
          const idx = y * sw + x;
          const lap =
            gray[idx - sw] +
            gray[idx + sw] +
            gray[idx - 1] +
            gray[idx + 1] -
            4 * gray[idx];
          sum += lap;
          sumSq += lap * lap;
          count++;
        }
      }
      if (count > 0) {
        const mean = sum / count;
        const variance = sumSq / count - mean * mean;
        blurScore = Math.round(Math.max(0, variance) * 100) / 100;
      }
    }

    return { width, height, blurScore, sha256 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractVideoFrames(
  file: File,
  intervalSeconds: number,
  maxFrames: number,
  onProgress?: (extracted: number) => void
): Promise<{ filename: string; blob: Blob }[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode video file.'));
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Video duration is invalid or unsupported.');
    }

    const step = Math.max(0.25, intervalSeconds);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');

    const frames: { filename: string; blob: Blob }[] = [];
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

    for (let t = 0; t < duration && frames.length < maxFrames; t += step) {
      video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      await new Promise<void>((resolve) => {
        const done = () => {
          video.removeEventListener('seeked', done);
          resolve();
        };
        video.addEventListener('seeked', done, { once: true });
      });

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9)
      );
      if (blob) {
        frames.push({
          filename: `${baseName}_f${String(frames.length + 1).padStart(3, '0')}.jpg`,
          blob,
        });
        onProgress?.(frames.length);
      }
    }

    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parseYoloLabels(
  txtContent: string,
  classes: string[]
): BoundingBox[] {
  const boxes: BoundingBox[] = [];
  const lines = txtContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (let idx = 0; idx < lines.length && boxes.length < 100; idx++) {
    const parts = lines[idx].split(/\s+/);
    if (parts.length < 5) continue;
    const classIdx = Number.parseInt(parts[0], 10);
    const cx = Number.parseFloat(parts[1]);
    const cy = Number.parseFloat(parts[2]);
    const w = Number.parseFloat(parts[3]);
    const h = Number.parseFloat(parts[4]);
    if (
      !Number.isFinite(classIdx) ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      w <= 0 ||
      h <= 0
    ) {
      continue;
    }

    const className = classes[classIdx] || `class_${classIdx}`;
    const x = clamp01(cx - w / 2);
    const y = clamp01(cy - h / 2);
    const clampedW = clamp01(Math.min(w, 1 - x));
    const clampedH = clamp01(Math.min(h, 1 - y));
    if (clampedW <= 0 || clampedH <= 0) continue;

    boxes.push({
      id: `box_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      className,
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      width: Number(clampedW.toFixed(4)),
      height: Number(clampedH.toFixed(4)),
    });
  }

  return boxes;
}

export interface ParsedCocoDataset {
  classes: string[];
  annotationsByFilename: Map<string, BoundingBox[]>;
}

export function parseCocoJson(jsonText: string): ParsedCocoDataset {
  const parsed = JSON.parse(jsonText) as {
    categories?: { id: number; name: string }[];
    images?: { id: number; file_name: string; width: number; height: number }[];
    annotations?: {
      id: number;
      image_id: number;
      category_id: number;
      bbox: [number, number, number, number];
    }[];
  };

  if (!Array.isArray(parsed.images) || !Array.isArray(parsed.categories)) {
    throw new Error('Invalid COCO JSON: missing images or categories arrays.');
  }

  const catMap = new Map<number, string>();
  const classes: string[] = [];
  for (const cat of parsed.categories) {
    if (typeof cat.name === 'string' && cat.name.trim()) {
      const clean = cat.name.trim().slice(0, 80);
      catMap.set(cat.id, clean);
      if (!classes.includes(clean) && classes.length < 50) {
        classes.push(clean);
      }
    }
  }

  const imgMap = new Map<number, { file_name: string; width: number; height: number }>();
  for (const img of parsed.images) {
    if (img.file_name && img.width > 0 && img.height > 0) {
      imgMap.set(img.id, img);
    }
  }

  const annotationsByFilename = new Map<string, BoundingBox[]>();
  for (const ann of parsed.annotations || []) {
    const img = imgMap.get(ann.image_id);
    const className = catMap.get(ann.category_id);
    if (!img || !className || !Array.isArray(ann.bbox) || ann.bbox.length < 4) continue;

    const [px, py, pw, ph] = ann.bbox;
    const x = clamp01(px / img.width);
    const y = clamp01(py / img.height);
    const width = clamp01(pw / img.width);
    const height = clamp01(ph / img.height);
    if (width <= 0 || height <= 0) continue;

    const baseName = img.file_name.split('/').pop() || img.file_name;
    const list = annotationsByFilename.get(baseName) || [];
    if (list.length < 100) {
      list.push({
        id: `coco_${ann.id}`,
        className,
        x: Number(x.toFixed(4)),
        y: Number(y.toFixed(4)),
        width: Number(width.toFixed(4)),
        height: Number(height.toFixed(4)),
      });
      annotationsByFilename.set(baseName, list);
    }
  }

  return { classes, annotationsByFilename };
}

export function assignSplitForIndex(
  index: number,
  total: number,
  trainPct: number,
  valPct: number
): DatasetSplit {
  if (total <= 1) return 'train';
  const ratio = (index + 0.5) / total;
  if (ratio <= trainPct / 100) return 'train';
  if (ratio <= (trainPct + valPct) / 100) return 'val';
  return 'test';
}

function getItemGroupKey(item: DatasetItem, taskType: V1TaskType): string {
  if (taskType === 'image_classification') {
    return item.classificationLabel.trim() || '__unlabeled__';
  }
  return item.annotations[0]?.className?.trim() || '__unlabeled__';
}

/**
 * Computes stratified per-class train/val/test assignments so every class
 * has proportional representation across splits (prioritizing train when small).
 */
export function assignStratifiedSplits(
  items: DatasetItem[],
  trainPct: number,
  valPct: number,
  taskType: V1TaskType
): Map<string, DatasetSplit> {
  const result = new Map<string, DatasetSplit>();
  const groups = new Map<string, DatasetItem[]>();

  for (const item of items) {
    const key = getItemGroupKey(item, taskType);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  for (const groupItems of groups.values()) {
    const total = groupItems.length;
    if (total === 1) {
      result.set(groupItems[0].id, 'train');
      continue;
    }
    if (total === 2) {
      result.set(groupItems[0].id, 'train');
      result.set(groupItems[1].id, valPct > 0 ? 'val' : 'train');
      continue;
    }

    const trainTarget = Math.max(1, Math.round((total * trainPct) / 100));
    const remaining = total - trainTarget;
    const valShare =
      valPct > 0 && remaining > 0
        ? Math.max(
            1,
            Math.round((remaining * valPct) / Math.max(1, 100 - trainPct))
          )
        : 0;
    const cappedVal = Math.min(remaining, valShare);

    groupItems.forEach((item, idx) => {
      if (idx < trainTarget) {
        result.set(item.id, 'train');
      } else if (idx < trainTarget + cappedVal) {
        result.set(item.id, 'val');
      } else {
        result.set(item.id, 'test');
      }
    });
  }

  return result;
}

/**
 * Picks train/val/test split incrementally for a single captured/added sample
 * within its class group, avoiding dumping sequential captures all into val/test.
 */
export function pickIncrementalSplit(
  existingItems: DatasetItem[],
  targetLabel: string,
  trainPct: number,
  valPct: number,
  taskType: V1TaskType
): DatasetSplit {
  const normalizedLabel = targetLabel.trim() || '__unlabeled__';
  const sameClass = existingItems.filter(
    (it) => getItemGroupKey(it, taskType) === normalizedLabel
  );
  const counts: Record<DatasetSplit, number> = { train: 0, val: 0, test: 0 };
  for (const it of sameClass) {
    counts[it.split] += 1;
  }

  const nextTotal = sameClass.length + 1;
  if (sameClass.length === 0 || counts.train === 0) return 'train';

  const testPct = Math.max(0, 100 - trainPct - valPct);
  const trainDeficit = (nextTotal * trainPct) / 100 - counts.train;
  const valDeficit = valPct > 0 ? (nextTotal * valPct) / 100 - counts.val : -999;
  const testDeficit = testPct > 0 ? (nextTotal * testPct) / 100 - counts.test : -999;

  if (trainDeficit >= valDeficit && trainDeficit >= testDeficit) return 'train';
  if (valDeficit >= testDeficit && valPct > 0) return 'val';
  if (testPct > 0) return 'test';
  return 'train';
}

export interface DatasetTrainingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalItems: number;
    annotatedItems: number;
    missingLabelsCount: number;
    unknownClassCount: number;
    invalidBoxCount: number;
    missingBlobCount: number;
    duplicateHashGroups: number;
    splitCounts: Record<DatasetSplit, number>;
    trainClassCounts: Record<string, number>;
    valClassCounts: Record<string, number>;
  };
}

/**
 * Validates dataset completeness, labels, YOLO bounding boxes, class mappings,
 * duplicates, and split coverage before executing real ML training.
 */
export function validateDatasetForTraining(params: {
  dataset: Dataset;
  items: DatasetItem[];
  taskType: V1TaskType;
  availableBlobIds?: Set<string>;
}): DatasetTrainingValidationResult {
  const { dataset, items, taskType, availableBlobIds } = params;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (dataset.classes.length === 0) {
    errors.push('Dataset has no defined classes.');
  }
  if (taskType === 'image_classification' && dataset.classes.length < 2) {
    errors.push('Image classification requires at least 2 distinct classes.');
  }
  if (items.length === 0) {
    errors.push('Dataset contains zero images.');
  }

  let missingLabelsCount = 0;
  let unknownClassCount = 0;
  let invalidBoxCount = 0;
  let missingBlobCount = 0;
  let annotatedItems = 0;

  const splitCounts: Record<DatasetSplit, number> = { train: 0, val: 0, test: 0 };
  const trainClassCounts: Record<string, number> = {};
  const valClassCounts: Record<string, number> = {};
  for (const cls of dataset.classes) {
    trainClassCounts[cls] = 0;
    valClassCounts[cls] = 0;
  }

  const hashCount = new Map<string, number>();

  for (const item of items) {
    hashCount.set(item.sha256, (hashCount.get(item.sha256) || 0) + 1);
    if (availableBlobIds && !availableBlobIds.has(item.id)) {
      missingBlobCount += 1;
      continue;
    }

    if (taskType === 'image_classification') {
      const label = item.classificationLabel.trim();
      if (!label) {
        missingLabelsCount += 1;
        continue;
      }
      if (!dataset.classes.includes(label)) {
        unknownClassCount += 1;
        continue;
      }
      annotatedItems += 1;
      splitCounts[item.split] += 1;
      if (item.split === 'train') {
        trainClassCounts[label] = (trainClassCounts[label] || 0) + 1;
      } else if (item.split === 'val') {
        valClassCounts[label] = (valClassCounts[label] || 0) + 1;
      }
    } else {
      if (!Array.isArray(item.annotations) || item.annotations.length === 0) {
        missingLabelsCount += 1;
        continue;
      }
      let itemHasValidBox = false;
      for (const box of item.annotations) {
        if (!dataset.classes.includes(box.className)) {
          unknownClassCount += 1;
          continue;
        }
        const validGeom =
          Number.isFinite(box.x) &&
          Number.isFinite(box.y) &&
          Number.isFinite(box.width) &&
          Number.isFinite(box.height) &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.width > 0.002 &&
          box.height > 0.002 &&
          box.x + box.width <= 1.001 &&
          box.y + box.height <= 1.001;
        if (!validGeom) {
          invalidBoxCount += 1;
        } else {
          itemHasValidBox = true;
          if (item.split === 'train') {
            trainClassCounts[box.className] = (trainClassCounts[box.className] || 0) + 1;
          } else if (item.split === 'val') {
            valClassCounts[box.className] = (valClassCounts[box.className] || 0) + 1;
          }
        }
      }
      if (itemHasValidBox) {
        annotatedItems += 1;
        splitCounts[item.split] += 1;
      }
    }
  }

  let duplicateHashGroups = 0;
  for (const cnt of hashCount.values()) {
    if (cnt > 1) duplicateHashGroups += 1;
  }

  if (missingBlobCount > 0) {
    warnings.push(`${missingBlobCount} dataset image(s) are missing local browser blobs and cannot be loaded for training.`);
  }
  if (missingLabelsCount > 0) {
    warnings.push(`${missingLabelsCount} image(s) have no class label or bounding box and will be excluded.`);
  }
  if (unknownClassCount > 0) {
    errors.push(`${unknownClassCount} annotation(s) reference class names not present in dataset.classes.`);
  }
  if (invalidBoxCount > 0) {
    errors.push(`${invalidBoxCount} bounding box annotation(s) have out-of-range or zero-area coordinates.`);
  }
  if (duplicateHashGroups > 0) {
    warnings.push(`${duplicateHashGroups} duplicate image group(s) detected via SHA-256 hash; verify no train/val leakage.`);
  }

  if (splitCounts.train < 2) {
    errors.push(`Train split needs at least 2 valid annotated images (found ${splitCounts.train}).`);
  }

  const classesMissingFromTrain = dataset.classes.filter((c) => (trainClassCounts[c] || 0) === 0);
  if (classesMissingFromTrain.length > 0 && dataset.classes.length > 0) {
    errors.push(
      `Classes missing from Train split: ${classesMissingFromTrain.join(', ')}. Use Stratified Auto-Split before training.`
    );
  }

  if (splitCounts.val === 0 && splitCounts.train >= 2) {
    warnings.push('Validation split has 0 annotated images; a clean subset of Train will be held out for epoch checkpoints.');
  }

  const nonZeroTrain = Object.values(trainClassCounts).filter((c) => c > 0);
  if (nonZeroTrain.length >= 2) {
    const ratio = Math.max(...nonZeroTrain) / Math.min(...nonZeroTrain);
    if (ratio >= 3) {
      warnings.push(`Train split class imbalance is ${ratio.toFixed(1)}x; class weights will be applied.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      totalItems: items.length,
      annotatedItems,
      missingLabelsCount,
      unknownClassCount,
      invalidBoxCount,
      missingBlobCount,
      duplicateHashGroups,
      splitCounts,
      trainClassCounts,
      valClassCounts,
    },
  };
}

export function auditDatasetQuality(
  dataset: Dataset,
  items: DatasetItem[],
  taskType: V1TaskType
): DatasetQualityReport {
  const splitCounts: Record<DatasetSplit, number> = { train: 0, val: 0, test: 0 };
  const classCounts: Record<string, number> = {};
  for (const cls of dataset.classes) {
    classCounts[cls] = 0;
  }

  const hashMap = new Map<string, { itemIds: string[]; filenames: string[] }>();
  const missingAnnotationIds: string[] = [];
  const invalidAnnotationIds: string[] = [];
  const lowResolutionIds: string[] = [];
  const blurryImageIds: string[] = [];

  let annotatedImages = 0;
  let approvedImages = 0;
  let totalSizeBytes = 0;

  for (const item of items) {
    splitCounts[item.split] += 1;
    totalSizeBytes += item.sizeBytes;
    if (item.isApproved) approvedImages += 1;

    // Duplicate hash grouping
    const existingGroup = hashMap.get(item.sha256) || { itemIds: [], filenames: [] };
    existingGroup.itemIds.push(item.id);
    existingGroup.filenames.push(item.filename);
    hashMap.set(item.sha256, existingGroup);

    // Resolution & blur checks
    if (Math.min(item.width, item.height) < 224) {
      lowResolutionIds.push(item.id);
    }
    if (item.blurScore < 45) {
      blurryImageIds.push(item.id);
    }

    if (taskType === 'image_classification') {
      if (!item.classificationLabel) {
        missingAnnotationIds.push(item.id);
      } else {
        annotatedImages += 1;
        classCounts[item.classificationLabel] =
          (classCounts[item.classificationLabel] || 0) + 1;
        if (
          dataset.classes.length > 0 &&
          !dataset.classes.includes(item.classificationLabel)
        ) {
          invalidAnnotationIds.push(item.id);
        }
      }
    } else {
      if (item.annotations.length === 0) {
        missingAnnotationIds.push(item.id);
      } else {
        annotatedImages += 1;
        let hasInvalid = false;
        for (const box of item.annotations) {
          classCounts[box.className] = (classCounts[box.className] || 0) + 1;
          if (
            box.x < 0 ||
            box.y < 0 ||
            box.width <= 0.002 ||
            box.height <= 0.002 ||
            box.x + box.width > 1.001 ||
            box.y + box.height > 1.001 ||
            (dataset.classes.length > 0 && !dataset.classes.includes(box.className))
          ) {
            hasInvalid = true;
          }
        }
        if (hasInvalid) invalidAnnotationIds.push(item.id);
      }
    }
  }

  const duplicateGroups: { sha256: string; itemIds: string[]; filenames: string[] }[] = [];
  for (const [sha256, group] of hashMap.entries()) {
    if (group.itemIds.length > 1) {
      duplicateGroups.push({ sha256, ...group });
    }
  }

  const nonZeroCounts = Object.values(classCounts).filter((c) => c > 0);
  const imbalanceRatio =
    nonZeroCounts.length >= 2
      ? Number((Math.max(...nonZeroCounts) / Math.min(...nonZeroCounts)).toFixed(2))
      : null;

  return {
    totalImages: items.length,
    annotatedImages,
    approvedImages,
    totalSizeBytes,
    splitCounts,
    classCounts,
    imbalanceRatio,
    duplicateGroups,
    missingAnnotationIds,
    invalidAnnotationIds,
    lowResolutionIds,
    blurryImageIds,
  };
}

export function exportToYoloBundle(dataset: Dataset, items: DatasetItem[]) {
  const files: Record<string, string> = {};
  files['classes.txt'] = dataset.classes.join('\n');
  files['data.yaml'] = [
    `# MK AI Dataset Export (YOLO Format)`,
    `# Dataset: ${dataset.name} (v${dataset.version})`,
    `nc: ${dataset.classes.length}`,
    `names: [${dataset.classes.map((c) => `'${c}'`).join(', ')}]`,
  ].join('\n');

  for (const item of items) {
    const stem = item.filename.replace(/\.[^.]+$/, '');
    const lines = item.annotations.map((box) => {
      const classId = Math.max(0, dataset.classes.indexOf(box.className));
      const cx = (box.x + box.width / 2).toFixed(6);
      const cy = (box.y + box.height / 2).toFixed(6);
      const w = box.width.toFixed(6);
      const h = box.height.toFixed(6);
      return `${classId} ${cx} ${cy} ${w} ${h}`;
    });
    files[`labels/${item.split}/${stem}.txt`] = lines.join('\n');
  }

  return files;
}

export function exportToCocoJson(dataset: Dataset, items: DatasetItem[]) {
  const categories = dataset.classes.map((name, idx) => ({
    id: idx + 1,
    name,
    supercategory: 'object',
  }));
  const catIdMap = new Map(dataset.classes.map((name, idx) => [name, idx + 1]));

  const images = items.map((item, idx) => ({
    id: idx + 1,
    file_name: `${item.split}/${item.filename}`,
    width: item.width,
    height: item.height,
    split: item.split,
    classification_label: item.classificationLabel || null,
  }));

  const annotations: {
    id: number;
    image_id: number;
    category_id: number;
    bbox: [number, number, number, number];
    area: number;
    iscrowd: number;
  }[] = [];

  let annId = 1;
  items.forEach((item, idx) => {
    const imageId = idx + 1;
    for (const box of item.annotations) {
      const x = Math.round(box.x * item.width);
      const y = Math.round(box.y * item.height);
      const w = Math.round(box.width * item.width);
      const h = Math.round(box.height * item.height);
      annotations.push({
        id: annId++,
        image_id: imageId,
        category_id: catIdMap.get(box.className) || 1,
        bbox: [x, y, w, h],
        area: w * h,
        iscrowd: 0,
      });
    }
  });

  return {
    info: {
      description: `${dataset.name} (v${dataset.version}) — Exported from MK AI by MK Tech`,
      version: String(dataset.version),
      date_created: new Date().toISOString(),
    },
    categories,
    images,
    annotations,
  };
}

/**
 * Deterministic letterbox canvas preprocessing shared across training,
 * validation, test evaluation, and inference so aspect ratio & padding match 1:1.
 */
export function renderPreprocessedCanvas(
  canvas: HTMLCanvasElement,
  sourceEl: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  inputSize: number,
  augConfig?: AugmentationConfig | null,
  options?: { stochastic?: boolean }
): void {
  canvas.width = inputSize;
  canvas.height = inputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const srcWidth =
    sourceEl instanceof HTMLImageElement
      ? sourceEl.naturalWidth || sourceEl.width || inputSize
      : sourceEl instanceof HTMLVideoElement
      ? sourceEl.videoWidth || inputSize
      : sourceEl.width || inputSize;
  const srcHeight =
    sourceEl instanceof HTMLImageElement
      ? sourceEl.naturalHeight || sourceEl.height || inputSize
      : sourceEl instanceof HTMLVideoElement
      ? sourceEl.videoHeight || inputSize
      : sourceEl.height || inputSize;

  ctx.save();
  ctx.clearRect(0, 0, inputSize, inputSize);
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, inputSize, inputSize);

  const stochastic = Boolean(options?.stochastic);
  let rotateDeg = augConfig?.rotateDeg ?? 0;
  let flipH = augConfig?.flipHorizontal ?? false;
  let flipV = augConfig?.flipVertical ?? false;
  let brightnessDelta = augConfig?.brightnessDelta ?? 0;
  let contrastDelta = augConfig?.contrastDelta ?? 0;
  const blurRadius = augConfig?.blurRadius ?? 0;
  const noiseLevel = augConfig?.noiseLevel ?? 0;

  if (augConfig && stochastic) {
    if (rotateDeg !== 0) rotateDeg = (Math.random() * 2 - 1) * Math.abs(rotateDeg);
    if (flipH) flipH = Math.random() >= 0.5;
    if (flipV) flipV = Math.random() >= 0.5;
    if (brightnessDelta !== 0) brightnessDelta = (Math.random() * 2 - 1) * Math.abs(brightnessDelta);
    if (contrastDelta !== 0) contrastDelta = (Math.random() * 2 - 1) * Math.abs(contrastDelta);
  }

  if (augConfig) {
    const brightness = Math.max(20, 100 + brightnessDelta);
    const contrast = Math.max(20, 100 + contrastDelta);
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) blur(${Math.max(0, blurRadius)}px)`;
  }

  ctx.translate(inputSize / 2, inputSize / 2);
  if (rotateDeg !== 0) ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

  const scale = Math.min(inputSize / Math.max(1, srcWidth), inputSize / Math.max(1, srcHeight));
  const dw = srcWidth * scale;
  const dh = srcHeight * scale;
  ctx.drawImage(sourceEl, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  if (augConfig && noiseLevel > 0) {
    const imgData = ctx.getImageData(0, 0, inputSize, inputSize);
    const data = imgData.data;
    const amp = noiseLevel * 2.2;
    for (let i = 0; i < data.length; i += 4) {
      const delta = (Math.random() - 0.5) * amp;
      data[i] = Math.max(0, Math.min(255, data[i] + delta));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + delta));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + delta));
    }
    ctx.putImageData(imgData, 0, 0);
  }
}

export function renderAugmentationPreview(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  cfg: AugmentationConfig
): void {
  const targetSize = Math.max(8, canvas.width || cfg.resizeWidth || 256);
  renderPreprocessedCanvas(canvas, img, targetSize, cfg, { stochastic: false });
}

