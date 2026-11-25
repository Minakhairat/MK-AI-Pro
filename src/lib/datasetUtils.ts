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

export function renderAugmentationPreview(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  cfg: AugmentationConfig
): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, w, h);

  const brightness = 100 + cfg.brightnessDelta;
  const contrast = 100 + cfg.contrastDelta;
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) blur(${cfg.blurRadius}px)`;

  ctx.translate(w / 2, h / 2);
  ctx.rotate((cfg.rotateDeg * Math.PI) / 180);
  ctx.scale(cfg.flipHorizontal ? -1 : 1, cfg.flipVertical ? -1 : 1);

  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  if (cfg.noiseLevel > 0) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const amp = cfg.noiseLevel * 2.2;
    for (let i = 0; i < data.length; i += 4) {
      const delta = (Math.random() - 0.5) * amp;
      data[i] = Math.max(0, Math.min(255, data[i] + delta));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + delta));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + delta));
    }
    ctx.putImageData(imgData, 0, 0);
  }
}
