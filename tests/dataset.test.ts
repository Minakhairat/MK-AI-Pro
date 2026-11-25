import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignSplitForIndex,
  auditDatasetQuality,
  DEFAULT_AUGMENTATION_CONFIG,
  exportToCocoJson,
  exportToYoloBundle,
  parseCocoJson,
  parseYoloLabels,
} from '../src/lib/datasetUtils.ts';
import type { Dataset, DatasetItem } from '../src/types/domain.ts';

function makeDataset(): Dataset {
  return {
    id: 'ds_test_1',
    projectId: 'proj_test_1',
    ownerUid: 'user_1',
    name: 'PCB Quality',
    description: 'Inspection dataset',
    version: 1,
    classes: ['pass', 'defect'],
    splitTrainPct: 70,
    splitValPct: 20,
    splitTestPct: 10,
    augmentationConfig: { ...DEFAULT_AUGMENTATION_CONFIG },
    imageCount: 3,
    annotatedCount: 2,
  };
}

function makeItem(overrides: Partial<DatasetItem>): DatasetItem {
  return {
    id: 'item_1',
    datasetId: 'ds_test_1',
    projectId: 'proj_test_1',
    ownerUid: 'user_1',
    filename: 'img1.jpg',
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
    sizeBytes: 12000,
    sha256: 'a'.repeat(64),
    sourceType: 'upload',
    split: 'train',
    classificationLabel: '',
    annotations: [],
    blurScore: 120,
    isApproved: false,
    ...overrides,
  };
}

test('parseYoloLabels converts YOLO cx cy w h into normalized bounding boxes', () => {
  const boxes = parseYoloLabels('1 0.5 0.5 0.4 0.2\n0 0.25 0.25 0.2 0.2', ['pass', 'defect']);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].className, 'defect');
  assert.equal(boxes[0].x, 0.3);
  assert.equal(boxes[0].y, 0.4);
  assert.equal(boxes[0].width, 0.4);
  assert.equal(boxes[0].height, 0.2);
});

test('parseCocoJson extracts categories and normalized bounding boxes by filename', () => {
  const coco = JSON.stringify({
    categories: [{ id: 10, name: 'scratch' }],
    images: [{ id: 1, file_name: 'train/sample_01.jpg', width: 1000, height: 500 }],
    annotations: [{ id: 99, image_id: 1, category_id: 10, bbox: [100, 100, 200, 100] }],
  });
  const result = parseCocoJson(coco);
  assert.deepEqual(result.classes, ['scratch']);
  const boxes = result.annotationsByFilename.get('sample_01.jpg');
  assert.ok(boxes && boxes.length === 1);
  assert.equal(boxes[0].x, 0.1);
  assert.equal(boxes[0].y, 0.2);
  assert.equal(boxes[0].width, 0.2);
  assert.equal(boxes[0].height, 0.2);
});

test('auditDatasetQuality detects duplicates, missing annotations, low resolution, blur, and imbalance', () => {
  const ds = makeDataset();
  const items: DatasetItem[] = [
    makeItem({
      id: 'i1',
      filename: 'a.jpg',
      sha256: '1'.repeat(64),
      annotations: [{ id: 'b1', className: 'pass', x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
      isApproved: true,
    }),
    makeItem({
      id: 'i2',
      filename: 'b.jpg',
      sha256: '1'.repeat(64),
      width: 120,
      height: 120,
      blurScore: 15,
      annotations: [],
    }),
    makeItem({
      id: 'i3',
      filename: 'c.jpg',
      sha256: '2'.repeat(64),
      split: 'test',
      annotations: [
        { id: 'b2', className: 'pass', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        { id: 'b3', className: 'pass', x: 0.3, y: 0.3, width: 0.1, height: 0.1 },
        { id: 'b4', className: 'pass', x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
        { id: 'b5', className: 'defect', x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
      ],
    }),
  ];

  const report = auditDatasetQuality(ds, items, 'object_detection');
  assert.equal(report.totalImages, 3);
  assert.equal(report.annotatedImages, 2);
  assert.equal(report.duplicateGroups.length, 1);
  assert.deepEqual(report.missingAnnotationIds, ['i2']);
  assert.deepEqual(report.lowResolutionIds, ['i2']);
  assert.deepEqual(report.blurryImageIds, ['i2']);
  assert.equal(report.imbalanceRatio, 4);
});

test('YOLO & COCO exporters generate valid structured annotations preserving splits', () => {
  const ds = makeDataset();
  const items = [
    makeItem({
      id: 'i1',
      filename: 'board.jpg',
      split: 'val',
      annotations: [{ id: 'b1', className: 'defect', x: 0.2, y: 0.3, width: 0.4, height: 0.2 }],
    }),
  ];

  const yolo = exportToYoloBundle(ds, items);
  assert.ok(yolo['classes.txt'].includes('defect'));
  assert.match(yolo['labels/val/board.txt'], /^1 0\.400000 0\.400000 0\.400000 0\.200000$/);

  const coco = exportToCocoJson(ds, items);
  assert.equal(coco.categories.length, 2);
  assert.equal(coco.annotations[0].category_id, 2);
  assert.deepEqual(coco.annotations[0].bbox, [128, 144, 256, 96]);
});

test('assignSplitForIndex allocates train/val/test according to percentages', () => {
  const splits = Array.from({ length: 10 }, (_, idx) =>
    assignSplitForIndex(idx, 10, 70, 20)
  );
  assert.equal(splits.filter((s) => s === 'train').length, 7);
  assert.equal(splits.filter((s) => s === 'val').length, 2);
  assert.equal(splits.filter((s) => s === 'test').length, 1);
});
