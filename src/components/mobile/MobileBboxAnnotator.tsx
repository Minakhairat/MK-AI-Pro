import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { clamp01, getClassColor } from '../../lib/datasetUtils';
import { getMediaBlob } from '../../lib/localMediaStore';
import { enqueueOfflineSyncAction } from '../../lib/mobileOfflineStore';
import {
  syncDatasetCounters,
  updateDatasetItemAnnotation,
} from '../../services/firestoreService';
import type { BoundingBox, Dataset, DatasetItem, Project } from '../../types/domain';

interface MobileBboxAnnotatorProps {
  project: Project;
  dataset: Dataset;
  items: DatasetItem[];
  isOnline: boolean;
}

export function MobileBboxAnnotator({
  project,
  dataset,
  items,
  isOnline,
}: MobileBboxAnnotatorProps) {
  const { locale } = useI18n();
  const [index, setIndex] = useState(0);
  const currentItem = items[index] || null;

  const [activeClass, setActiveClass] = useState(dataset.classes[0] || '');
  const [boxes, setBoxes] = useState<BoundingBox[]>([]);
  const [clsLabel, setClsLabel] = useState('');
  const [approved, setApproved] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (index >= items.length && items.length > 0) {
      setIndex(items.length - 1);
    }
  }, [items.length, index]);

  useEffect(() => {
    if (dataset.classes.length > 0 && !dataset.classes.includes(activeClass)) {
      setActiveClass(dataset.classes[0]);
    }
  }, [dataset.classes, activeClass]);

  useEffect(() => {
    if (!currentItem) {
      setImgUrl(null);
      setBoxes([]);
      setClsLabel('');
      setApproved(false);
      return;
    }
    setBoxes(currentItem.annotations || []);
    setClsLabel(currentItem.classificationLabel || '');
    setApproved(currentItem.isApproved);
    setNotice(null);

    let alive = true;
    let url: string | null = null;
    void getMediaBlob(currentItem.id).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setImgUrl(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [currentItem?.id]);

  const toNormalizedPoint = (clientX: number, clientY: number) => {
    const el = surfaceRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: clamp01((clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((clientY - rect.top) / Math.max(1, rect.height)),
    };
  };

  const draftRect = useMemo(() => {
    if (!drawStart || !drawCurrent) return null;
    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const width = Math.abs(drawCurrent.x - drawStart.x);
    const height = Math.abs(drawCurrent.y - drawStart.y);
    return { x, y, width, height };
  }, [drawStart, drawCurrent]);

  const persistAnnotation = async (
    nextLabel: string,
    nextBoxes: BoundingBox[],
    nextApproved: boolean
  ) => {
    if (!currentItem) return;
    setSaving(true);
    setNotice(null);

    const annotatedCountHint = items.filter((it) => {
      if (it.id === currentItem.id) {
        return project.taskType === 'image_classification'
          ? Boolean(nextLabel)
          : nextBoxes.length > 0;
      }
      return project.taskType === 'image_classification'
        ? Boolean(it.classificationLabel)
        : it.annotations.length > 0;
    }).length;

    try {
      if (isOnline) {
        await updateDatasetItemAnnotation({
          datasetId: dataset.id,
          itemId: currentItem.id,
          classificationLabel: nextLabel,
          annotations: nextBoxes,
          isApproved: nextApproved,
        });
        await syncDatasetCounters({
          datasetId: dataset.id,
          imageCount: items.length,
          annotatedCount: annotatedCountHint,
        });
        setNotice(locale === 'ar' ? 'تم حفظ التعليق' : 'Saved & synced');
      } else {
        await enqueueOfflineSyncAction({
          type: 'update_annotation',
          projectId: project.id,
          datasetId: dataset.id,
          itemId: currentItem.id,
          storageLocation: project.storageLocation,
          cloudConsentGranted: project.cloudConsentGranted,
          payload: {
            datasetId: dataset.id,
            itemId: currentItem.id,
            classificationLabel: nextLabel,
            annotations: nextBoxes,
            isApproved: nextApproved,
            totalItemsHint: items.length,
            annotatedCountHint,
          },
        });
        setNotice(locale === 'ar' ? 'حُفظ أوفلاين للمزامنة' : 'Queued offline');
      }
    } finally {
      setSaving(false);
    }
  };

  if (items.length === 0 || !currentItem) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-xs text-zinc-500">
        {locale === 'ar'
          ? 'التقط أو ارفع صوراً أولاً لبدء التعليق باللمس.'
          : 'Capture or add images first to begin touch annotation.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Item Navigation Header */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          aria-label="Previous"
          className="min-w-[44px] min-h-[44px] rounded-lg border border-zinc-300 dark:border-zinc-700 inline-flex items-center justify-center disabled:opacity-40"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="text-center min-w-0">
          <div className="text-xs font-mono font-semibold tabular-nums">
            {index + 1} / {items.length}
          </div>
          <div className="text-[11px] text-zinc-500 truncate max-w-[180px]">
            {currentItem.filename}
          </div>
        </div>

        <button
          type="button"
          disabled={index >= items.length - 1}
          onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
          aria-label="Next"
          className="min-w-[44px] min-h-[44px] rounded-lg border border-zinc-300 dark:border-zinc-700 inline-flex items-center justify-center disabled:opacity-40"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Active Class Selector */}
      {dataset.classes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dataset.classes.map((cls) => {
            const active =
              project.taskType === 'image_classification'
                ? clsLabel === cls
                : activeClass === cls;
            return (
              <button
                key={cls}
                type="button"
                onClick={() => {
                  setActiveClass(cls);
                  if (project.taskType === 'image_classification') {
                    setClsLabel(cls);
                    void persistAnnotation(cls, [], true);
                    setApproved(true);
                  }
                }}
                className={`min-h-[44px] px-3.5 rounded-lg text-xs font-semibold border transition-colors ${
                  active
                    ? 'bg-red-600 text-white border-red-600'
                    : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900'
                }`}
              >
                {cls}
              </button>
            );
          })}
        </div>
      )}

      {/* Touch Drawing Canvas */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="p-2 bg-zinc-900 flex items-center justify-between text-[11px] text-zinc-300">
          <span>
            {project.taskType === 'object_detection'
              ? locale === 'ar'
                ? 'اسحب بإصبعك لرسم مربع'
                : 'Drag finger to draw box'
              : locale === 'ar'
              ? 'اضغط على الفئة أعلاه للتصنيف'
              : 'Tap class above to label'}
          </span>
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-zinc-700 inline-flex items-center gap-1"
          >
            {zoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
            <span>{zoomed ? '1x' : '1.4x'}</span>
          </button>
        </div>

        <div className="overflow-auto max-h-[380px] flex items-center justify-center p-2">
          {imgUrl ? (
            <div
              ref={surfaceRef}
              onPointerDown={(e) => {
                if (project.taskType !== 'object_detection' || !activeClass) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const pt = toNormalizedPoint(e.clientX, e.clientY);
                setDrawStart(pt);
                setDrawCurrent(pt);
              }}
              onPointerMove={(e) => {
                if (!drawStart) return;
                setDrawCurrent(toNormalizedPoint(e.clientX, e.clientY));
              }}
              onPointerUp={(e) => {
                if (!drawStart || !drawCurrent) return;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                const x = Math.min(drawStart.x, drawCurrent.x);
                const y = Math.min(drawStart.y, drawCurrent.y);
                const width = Math.abs(drawCurrent.x - drawStart.x);
                const height = Math.abs(drawCurrent.y - drawStart.y);
                setDrawStart(null);
                setDrawCurrent(null);

                if (width >= 0.025 && height >= 0.025 && activeClass) {
                  const nextBox: BoundingBox = {
                    id: `mbox_${Date.now().toString(36)}`,
                    className: activeClass,
                    x: Number(x.toFixed(4)),
                    y: Number(y.toFixed(4)),
                    width: Number(width.toFixed(4)),
                    height: Number(height.toFixed(4)),
                  };
                  const nextBoxes = [...boxes, nextBox];
                  setBoxes(nextBoxes);
                  setApproved(true);
                  void persistAnnotation(clsLabel, nextBoxes, true);
                }
              }}
              onPointerCancel={() => {
                setDrawStart(null);
                setDrawCurrent(null);
              }}
              className={`relative select-none ${
                project.taskType === 'object_detection' ? 'touch-none' : ''
              } ${zoomed ? 'w-[140%]' : 'w-full'}`}
            >
              <img
                src={imgUrl}
                alt={currentItem.filename}
                draggable={false}
                className="w-full h-auto block pointer-events-none select-none rounded"
              />

              {boxes.map((box) => {
                const color = getClassColor(box.className, dataset.classes);
                return (
                  <div
                    key={box.id}
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                      borderColor: color,
                    }}
                    className="absolute border-2 pointer-events-none"
                  >
                    <span
                      style={{ backgroundColor: color }}
                      className="text-[10px] font-semibold text-white px-1 py-0.5 inline-block leading-none"
                    >
                      {box.className}
                    </span>
                  </div>
                );
              })}

              {draftRect && (
                <div
                  style={{
                    left: `${draftRect.x * 100}%`,
                    top: `${draftRect.y * 100}%`,
                    width: `${draftRect.width * 100}%`,
                    height: `${draftRect.height * 100}%`,
                  }}
                  className="absolute border-2 border-dashed border-red-500 bg-red-500/15 pointer-events-none"
                />
              )}
            </div>
          ) : (
            <div className="py-12 text-xs text-zinc-400">
              {locale === 'ar'
                ? 'الصورة غير مخزنة محلياً على هذا الهاتف'
                : 'Local image blob not stored on this device'}
            </div>
          )}
        </div>
      </div>

      {/* Box List & Quick Actions */}
      {project.taskType === 'object_detection' && boxes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {boxes.map((box) => (
            <button
              key={box.id}
              type="button"
              onClick={() => {
                const next = boxes.filter((b) => b.id !== box.id);
                setBoxes(next);
                void persistAnnotation(clsLabel, next, next.length > 0);
              }}
              className="min-h-[44px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs inline-flex items-center gap-1.5"
            >
              <span>{box.className}</span>
              <Trash2 className="w-3.5 h-3.5 text-red-600" />
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            const nextApproved = !approved;
            setApproved(nextApproved);
            void persistAnnotation(clsLabel, boxes, nextApproved);
          }}
          className={`min-h-[44px] flex-1 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 ${
            approved
              ? 'bg-emerald-600 text-white'
              : 'border border-zinc-300 dark:border-zinc-700'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>
            {approved
              ? locale === 'ar'
                ? 'معتمد'
                : 'Approved'
              : locale === 'ar'
              ? 'اعتماد العينة'
              : 'Approve Sample'}
          </span>
        </button>

        {notice && (
          <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
            {notice}
          </span>
        )}
      </div>
    </div>
  );
}
