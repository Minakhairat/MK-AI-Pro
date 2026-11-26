import type {
  DesktopStagedDatasetResult,
  MkDesktopApi,
  StagedClassificationImageInput,
  StagedDetectionImageInput,
} from '../types/desktop';
import type { Dataset, DatasetItem, V1TaskType } from '../types/domain';
import { getMediaBlob } from './localMediaStore';

declare global {
  interface Window {
    mkDesktop?: MkDesktopApi;
  }
}

export function getDesktopBridge(): MkDesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.mkDesktop ?? null;
}

export function isDesktopApp(): boolean {
  return Boolean(getDesktopBridge());
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function stageDatasetItemsFromIndexedDb(params: {
  dataset: Dataset;
  items: DatasetItem[];
  taskType: V1TaskType;
}): Promise<DesktopStagedDatasetResult> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error('MK AI Desktop bridge is not available in a standard browser.');
  }

  if (params.taskType === 'image_classification') {
    const classificationImages: StagedClassificationImageInput[] = [];
    for (const item of params.items) {
      if (!item.classificationLabel) continue;
      const blob = await getMediaBlob(item.id);
      if (!blob) continue;
      classificationImages.push({
        itemId: item.id,
        split: item.split,
        className: item.classificationLabel,
        filename: item.filename,
        mimeType: item.mimeType,
        base64Data: await blobToBase64(blob),
      });
    }
    if (classificationImages.length < 2) {
      throw new Error(
        'Not enough locally stored images found in IndexedDB to stage for Python training.'
      );
    }
    return bridge.stageDatasetForLocalTraining({
      datasetId: params.dataset.id,
      taskType: 'image_classification',
      classes: params.dataset.classes,
      classificationImages,
    });
  }

  const classIndexMap = new Map<string, number>();
  params.dataset.classes.forEach((c, idx) => classIndexMap.set(c, idx));

  const detectionImages: StagedDetectionImageInput[] = [];
  for (const item of params.items) {
    if (!item.annotations || item.annotations.length === 0) continue;
    const blob = await getMediaBlob(item.id);
    if (!blob) continue;
    const boxes = item.annotations
      .map((box) => {
        const idx = classIndexMap.get(box.className);
        if (idx === undefined) return null;
        return {
          classIndex: idx,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);

    if (boxes.length === 0) continue;
    detectionImages.push({
      itemId: item.id,
      split: item.split,
      filename: item.filename,
      mimeType: item.mimeType,
      base64Data: await blobToBase64(blob),
      boxes,
    });
  }

  if (detectionImages.length < 2) {
    throw new Error(
      'Not enough locally annotated detection images found in IndexedDB to stage YOLO dataset.'
    );
  }

  return bridge.stageDatasetForLocalTraining({
    datasetId: params.dataset.id,
    taskType: 'object_detection',
    classes: params.dataset.classes,
    detectionImages,
  });
}
