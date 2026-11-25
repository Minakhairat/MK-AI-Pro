import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Move,
  RotateCcw,
  Target,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import { clamp01, getClassColor } from '../../lib/datasetUtils';
import { getMediaBlob } from '../../lib/localMediaStore';
import {
  syncDatasetCounters,
  updateDatasetItemAnnotation,
} from '../../services/firestoreService';
import type { BoundingBox, Dataset, DatasetItem, Project } from '../../types/domain';
import { EmptyState } from '../common/EmptyState';

interface AnnotationStudioProps {
  project: Project;
  dataset: Dataset | null;
  items: DatasetItem[];
  initialItemId?: string | null;
}

export function AnnotationStudio({
  project,
  dataset,
  items,
  initialItemId,
}: AnnotationStudioProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | 'unlabeled' | 'approved'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(initialItemId || null);
  const [activeClass, setActiveClass] = useState<string>(dataset?.classes[0] || '');
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

  // Viewport zoom & pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);

  // Drawing state
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [draftBox, setDraftBox] = useState<{
    startX: number;
    startY: number;
    currX: number;
    currY: number;
  } | null>(null);
  const [panDrag, setPanDrag] = useState<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (initialItemId) setSelectedId(initialItemId);
  }, [initialItemId]);

  useEffect(() => {
    if (dataset && dataset.classes.length > 0 && !dataset.classes.includes(activeClass)) {
      setActiveClass(dataset.classes[0]);
    }
  }, [dataset, activeClass]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'approved') return item.isApproved;
      if (filter === 'unlabeled') {
        return project.taskType === 'image_classification'
          ? !item.classificationLabel
          : item.annotations.length === 0;
      }
      return true;
    });
  }, [items, filter, project.taskType]);

  const currentItem = useMemo(() => {
    if (filteredItems.length === 0) return null;
    const found = filteredItems.find((i) => i.id === selectedId);
    return found || filteredItems[0];
  }, [filteredItems, selectedId]);

  const currentIndex = currentItem
    ? filteredItems.findIndex((i) => i.id === currentItem.id)
    : -1;

  useEffect(() => {
    if (!currentItem) {
      setImageUrl(null);
      return;
    }
    let active = true;
    let objUrl: string | null = null;
    void getMediaBlob(currentItem.id).then((blob) => {
      if (!active) return;
      if (blob) {
        objUrl = URL.createObjectURL(blob);
        setImageUrl(objUrl);
      } else {
        setImageUrl(null);
      }
    });
    setSelectedBoxId(null);
    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [currentItem?.id]);

  const persistAnnotation = async (
    item: DatasetItem,
    nextLabel: string,
    nextBoxes: BoundingBox[],
    nextApproved: boolean
  ) => {
    if (!dataset) return;
    await updateDatasetItemAnnotation({
      datasetId: dataset.id,
      itemId: item.id,
      classificationLabel: nextLabel,
      annotations: nextBoxes,
      isApproved: nextApproved,
    });
    const annotatedCount = items.reduce((acc, it) => {
      const label = it.id === item.id ? nextLabel : it.classificationLabel;
      const boxes = it.id === item.id ? nextBoxes : it.annotations;
      const isAnn =
        project.taskType === 'image_classification'
          ? Boolean(label)
          : boxes.length > 0;
      return acc + (isAnn ? 1 : 0);
    }, 0);
    await syncDatasetCounters({
      datasetId: dataset.id,
      imageCount: items.length,
      annotatedCount,
    });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!currentItem || !dataset) return;

      if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        if (currentIndex < filteredItems.length - 1) {
          setSelectedId(filteredItems[currentIndex + 1].id);
        }
      } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        if (currentIndex > 0) {
          setSelectedId(filteredItems[currentIndex - 1].id);
        }
      } else if (e.key === '0') {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === ' ') {
        e.preventDefault();
        void persistAnnotation(
          currentItem,
          currentItem.classificationLabel,
          currentItem.annotations,
          !currentItem.isApproved
        );
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBoxId) {
        e.preventDefault();
        const nextBoxes = currentItem.annotations.filter((b) => b.id !== selectedBoxId);
        setSelectedBoxId(null);
        void persistAnnotation(
          currentItem,
          currentItem.classificationLabel,
          nextBoxes,
          currentItem.isApproved
        );
      } else if (/^[1-9]$/.test(e.key)) {
        const cls = dataset.classes[Number(e.key) - 1];
        if (!cls) return;
        setActiveClass(cls);
        if (project.taskType === 'image_classification') {
          void persistAnnotation(
            currentItem,
            cls,
            currentItem.annotations,
            true
          );
        } else if (selectedBoxId) {
          const nextBoxes = currentItem.annotations.map((b) =>
            b.id === selectedBoxId ? { ...b, className: cls } : b
          );
          void persistAnnotation(
            currentItem,
            currentItem.classificationLabel,
            nextBoxes,
            currentItem.isApproved
          );
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentItem, currentIndex, filteredItems, dataset, selectedBoxId, project.taskType]);

  if (!dataset) {
    return (
      <EmptyState
        icon={Target}
        title={t.annotationStudio.noDatasetTitle}
        description={t.annotationStudio.noDatasetDesc}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title={t.annotationStudio.noImagesTitle}
        description={t.annotationStudio.noImagesDesc}
      />
    );
  }

  const getRelativeCoords = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  };

  const handleStageMouseDown = (e: React.MouseEvent) => {
    if (!currentItem) return;
    if (panMode || e.button === 1 || e.shiftKey) {
      setPanDrag({
        startX: e.clientX,
        startY: e.clientY,
        origX: pan.x,
        origY: pan.y,
      });
      return;
    }
    if (project.taskType !== 'object_detection' || !activeClass) return;
    const pt = getRelativeCoords(e.clientX, e.clientY);
    setDraftBox({ startX: pt.x, startY: pt.y, currX: pt.x, currY: pt.y });
  };

  const handleStageMouseMove = (e: React.MouseEvent) => {
    if (panDrag) {
      setPan({
        x: panDrag.origX + (e.clientX - panDrag.startX),
        y: panDrag.origY + (e.clientY - panDrag.startY),
      });
      return;
    }
    if (draftBox) {
      const pt = getRelativeCoords(e.clientX, e.clientY);
      setDraftBox({ ...draftBox, currX: pt.x, currY: pt.y });
    }
  };

  const handleStageMouseUp = () => {
    if (panDrag) {
      setPanDrag(null);
      return;
    }
    if (!draftBox || !currentItem || !activeClass) {
      setDraftBox(null);
      return;
    }

    const x = Math.min(draftBox.startX, draftBox.currX);
    const y = Math.min(draftBox.startY, draftBox.currY);
    const width = Math.abs(draftBox.currX - draftBox.startX);
    const height = Math.abs(draftBox.currY - draftBox.startY);
    setDraftBox(null);

    if (width < 0.01 || height < 0.01) return;

    const newBox: BoundingBox = {
      id: `box_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      className: activeClass,
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      width: Number(width.toFixed(4)),
      height: Number(height.toFixed(4)),
    };
    const nextBoxes = [...currentItem.annotations, newBox].slice(0, 100);
    setSelectedBoxId(newBox.id);
    void persistAnnotation(
      currentItem,
      currentItem.classificationLabel,
      nextBoxes,
      currentItem.isApproved
    );
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 bg-white dark:bg-zinc-900 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-950">
          {(
            [
              { id: 'all', label: t.annotationStudio.filterAll },
              { id: 'unlabeled', label: t.annotationStudio.filterUnlabeled },
              { id: 'approved', label: t.annotationStudio.filterApproved },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                filter === f.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentIndex <= 0}
            onClick={() => setSelectedId(filteredItems[currentIndex - 1].id)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>{t.annotationStudio.prevBtn}</span>
          </button>
          <span className="text-xs font-mono tabular-nums px-2">
            {currentItem ? `${currentIndex + 1} / ${filteredItems.length}` : '0 / 0'}
          </span>
          <button
            type="button"
            disabled={currentIndex < 0 || currentIndex >= filteredItems.length - 1}
            onClick={() => setSelectedId(filteredItems[currentIndex + 1].id)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 disabled:opacity-40"
          >
            <span>{t.annotationStudio.nextBtn}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
            title={t.annotationStudio.zoomOut}
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono tabular-nums w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
            title={t.annotationStudio.zoomIn}
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setPanMode((p) => !p)}
            title="Pan"
            className={`p-1.5 rounded-lg border ${
              panMode
                ? 'border-red-600 bg-red-50 dark:bg-red-950/30 text-red-600'
                : 'border-zinc-200 dark:border-zinc-800'
            }`}
          >
            <Move className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title={t.annotationStudio.resetView}
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {currentItem && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Interactive Canvas Stage */}
          <div className="lg:col-span-3 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-zinc-950 overflow-hidden flex flex-col">
            <div className="relative h-[480px] overflow-hidden flex items-center justify-center select-none">
              {imageUrl ? (
                <div
                  ref={stageRef}
                  onMouseDown={handleStageMouseDown}
                  onMouseMove={handleStageMouseMove}
                  onMouseUp={handleStageMouseUp}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                  }}
                  className={`relative inline-block ${
                    panMode
                      ? 'cursor-grab active:cursor-grabbing'
                      : project.taskType === 'object_detection'
                      ? 'cursor-crosshair'
                      : 'cursor-default'
                  }`}
                >
                  <img
                    src={imageUrl}
                    alt={currentItem.filename}
                    draggable={false}
                    className="max-h-[450px] max-w-full object-contain block pointer-events-none"
                  />

                  {/* Existing Bounding Boxes */}
                  {project.taskType === 'object_detection' &&
                    currentItem.annotations.map((box) => {
                      const color = getClassColor(box.className, dataset.classes);
                      const isSelected = box.id === selectedBoxId;
                      return (
                        <div
                          key={box.id}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setSelectedBoxId(box.id);
                          }}
                          style={{
                            left: `${box.x * 100}%`,
                            top: `${box.y * 100}%`,
                            width: `${box.width * 100}%`,
                            height: `${box.height * 100}%`,
                            borderColor: color,
                            backgroundColor: isSelected ? `${color}30` : `${color}15`,
                          }}
                          className={`absolute border-2 ${
                            isSelected ? 'ring-2 ring-white' : ''
                          }`}
                        >
                          <span
                            style={{ backgroundColor: color }}
                            className="absolute -top-5 start-0 px-1.5 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap"
                          >
                            {box.className}
                          </span>
                        </div>
                      );
                    })}

                  {/* Active Draft Box */}
                  {draftBox && (
                    <div
                      style={{
                        left: `${Math.min(draftBox.startX, draftBox.currX) * 100}%`,
                        top: `${Math.min(draftBox.startY, draftBox.currY) * 100}%`,
                        width: `${Math.abs(draftBox.currX - draftBox.startX) * 100}%`,
                        height: `${Math.abs(draftBox.currY - draftBox.startY) * 100}%`,
                      }}
                      className="absolute border-2 border-dashed border-red-500 bg-red-500/20 pointer-events-none"
                    />
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-400">
                  Local image blob missing in this browser session.
                </p>
              )}
            </div>

            <div className="px-4 py-2.5 bg-zinc-900 border-t border-zinc-800 text-[11px] text-zinc-400 flex flex-wrap items-center justify-between gap-2">
              <span>{t.annotationStudio.shortcutsDesc}</span>
              <span className="font-mono tabular-nums">
                {currentItem.filename} · {currentItem.width}×{currentItem.height} ·{' '}
                {t.annotationStudio.blurScoreLabel}: {currentItem.blurScore}
              </span>
            </div>
          </div>

          {/* Right Control Rail */}
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-900 space-y-5 h-fit">
            <button
              type="button"
              onClick={() =>
                void persistAnnotation(
                  currentItem,
                  currentItem.classificationLabel,
                  currentItem.annotations,
                  !currentItem.isApproved
                )
              }
              className={`w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
                currentItem.isApproved
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-red-600 text-white hover:bg-red-700'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {currentItem.isApproved
                  ? t.annotationStudio.approvedLabel
                  : t.annotationStudio.approveBtn}
              </span>
            </button>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {t.annotationStudio.activeClassLabel}
              </p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {project.taskType === 'image_classification'
                  ? t.annotationStudio.classificationHint
                  : t.annotationStudio.detectionHint}
              </p>

              <div className="space-y-1.5 pt-1">
                {dataset.classes.map((cls, idx) => {
                  const color = getClassColor(cls, dataset.classes);
                  const isAssigned =
                    project.taskType === 'image_classification'
                      ? currentItem.classificationLabel === cls
                      : activeClass === cls;
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => {
                        setActiveClass(cls);
                        if (project.taskType === 'image_classification') {
                          void persistAnnotation(
                            currentItem,
                            cls,
                            currentItem.annotations,
                            true
                          );
                        } else if (selectedBoxId) {
                          const nextBoxes = currentItem.annotations.map((b) =>
                            b.id === selectedBoxId ? { ...b, className: cls } : b
                          );
                          void persistAnnotation(
                            currentItem,
                            currentItem.classificationLabel,
                            nextBoxes,
                            currentItem.isApproved
                          );
                        }
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                        isAssigned
                          ? 'border-red-600 bg-red-50/50 dark:bg-red-950/20 text-zinc-900 dark:text-zinc-100'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{cls}</span>
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {idx < 9 ? idx + 1 : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {project.taskType === 'object_detection' && (
              <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {t.annotationStudio.boxesTitle} ({currentItem.annotations.length})
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {currentItem.annotations.map((box) => (
                    <div
                      key={box.id}
                      onClick={() => setSelectedBoxId(box.id)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                        box.id === selectedBoxId
                          ? 'border-red-600 bg-red-50/40 dark:bg-red-950/20'
                          : 'border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      <span className="truncate font-medium">{box.className}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextBoxes = currentItem.annotations.filter(
                            (b) => b.id !== box.id
                          );
                          if (selectedBoxId === box.id) setSelectedBoxId(null);
                          void persistAnnotation(
                            currentItem,
                            currentItem.classificationLabel,
                            nextBoxes,
                            currentItem.isApproved
                          );
                        }}
                        className="text-zinc-400 hover:text-red-600"
                        aria-label={t.annotationStudio.deleteBox}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
