import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  Film,
  ImagePlus,
  Layers,
  Plus,
  RefreshCw,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import {
  ALLOWED_IMAGE_MIMES,
  analyzeImageBlob,
  assignSplitForIndex,
  auditDatasetQuality,
  DEFAULT_AUGMENTATION_CONFIG,
  exportToCocoJson,
  exportToYoloBundle,
  extractVideoFrames,
  parseCocoJson,
  parseYoloLabels,
  renderAugmentationPreview,
} from '../../lib/datasetUtils';
import { getMediaBlob, saveMediaBlob } from '../../lib/localMediaStore';
import {
  addDatasetItem,
  applyBulkItemSplits,
  createDataset,
  deleteDatasetItem,
  logActivity,
  syncDatasetCounters,
  updateDatasetAugmentation,
  updateDatasetClassesAndMeta,
  updateDatasetSplits,
  updateProjectDatasetState,
} from '../../services/firestoreService';
import type {
  AugmentationConfig,
  BoundingBox,
  Dataset,
  DatasetItem,
  DatasetSourceType,
  Project,
} from '../../types/domain';

interface DatasetStudioProps {
  project: Project;
  datasets: Dataset[];
  activeDataset: Dataset | null;
  items: DatasetItem[];
  onSelectDataset: (datasetId: string) => void;
  onOpenAnnotator: (itemId?: string) => void;
}

type StudioSubTab = 'ingest' | 'classesSplits' | 'quality' | 'augmentation';

function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DatasetThumbnail({ itemId, alt }: { itemId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void getMediaBlob(itemId)
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId]);

  if (!url) {
    return (
      <div className="w-full h-28 bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-xs text-zinc-400">
        No local blob
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className="w-full h-28 object-cover bg-zinc-950"
    />
  );
}

export function DatasetStudio({
  project,
  datasets,
  activeDataset,
  items,
  onSelectDataset,
  onOpenAnnotator,
}: DatasetStudioProps) {
  const { t } = useI18n();
  const [subTab, setSubTab] = useState<StudioSubTab>('ingest');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create dataset state
  const [dsName, setDsName] = useState('');
  const [dsDesc, setDsDesc] = useState('');
  const [dsClassesInput, setDsClassesInput] = useState('');
  const [creatingDs, setCreatingDs] = useState(false);

  // Ingestion states
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [videoInterval, setVideoInterval] = useState(1);
  const [videoMaxFrames, setVideoMaxFrames] = useState(15);

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const burstTimerRef = useRef<number | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [burstRunning, setBurstRunning] = useState(false);
  const [burstCount, setBurstCount] = useState(0);

  // Classes & Splits state
  const [newClassInput, setNewClassInput] = useState('');
  const [trainPct, setTrainPct] = useState(activeDataset?.splitTrainPct ?? 70);
  const [valPct, setValPct] = useState(activeDataset?.splitValPct ?? 20);
  const [testPct, setTestPct] = useState(activeDataset?.splitTestPct ?? 10);

  // Augmentation state
  const [augCfg, setAugCfg] = useState<AugmentationConfig>(
    activeDataset?.augmentationConfig ?? DEFAULT_AUGMENTATION_CONFIG
  );
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (activeDataset) {
      setTrainPct(activeDataset.splitTrainPct);
      setValPct(activeDataset.splitValPct);
      setTestPct(activeDataset.splitTestPct);
      setAugCfg(activeDataset.augmentationConfig || DEFAULT_AUGMENTATION_CONFIG);
    }
  }, [activeDataset]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (burstTimerRef.current) window.clearInterval(burstTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  // Render live augmentation preview on first sample image
  useEffect(() => {
    if (subTab !== 'augmentation' || !previewCanvasRef.current || items.length === 0) return;
    let cancelled = false;
    let objUrl: string | null = null;
    void getMediaBlob(items[0].id).then((blob) => {
      if (cancelled || !blob || !previewCanvasRef.current) return;
      objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (!cancelled && previewCanvasRef.current) {
          renderAugmentationPreview(previewCanvasRef.current, img, augCfg);
        }
        if (objUrl) URL.revokeObjectURL(objUrl);
      };
      img.src = objUrl;
    });
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [subTab, augCfg, items]);

  const qualityReport = useMemo(() => {
    if (!activeDataset) return null;
    return auditDatasetQuality(activeDataset, items, project.taskType);
  }, [activeDataset, items, project.taskType]);

  const handleCreateDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    setCreatingDs(true);
    try {
      const classes = dsClassesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const created = await createDataset({
        ownerUid: project.ownerUid,
        projectId: project.id,
        currentDatasetCount: project.datasetCount,
        name: dsName,
        description: dsDesc,
        classes,
      });
      setDsName('');
      setDsDesc('');
      setDsClassesInput('');
      setShowCreateForm(false);
      onSelectDataset(created.id);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to create dataset.');
    } finally {
      setCreatingDs(false);
    }
  };

  const ingestSingleBlob = async (params: {
    blob: Blob;
    filename: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    sourceType: DatasetSourceType;
    index: number;
    total: number;
    classificationLabel?: string;
    annotations?: BoundingBox[];
  }) => {
    if (!activeDataset) return;
    const analysis = await analyzeImageBlob(params.blob);
    const split = assignSplitForIndex(
      params.index,
      params.total,
      activeDataset.splitTrainPct,
      activeDataset.splitValPct
    );
    const item = await addDatasetItem({
      datasetId: activeDataset.id,
      projectId: project.id,
      ownerUid: project.ownerUid,
      filename: params.filename,
      mimeType: params.mimeType,
      width: analysis.width,
      height: analysis.height,
      sizeBytes: params.blob.size,
      sha256: analysis.sha256,
      sourceType: params.sourceType,
      split,
      classificationLabel: params.classificationLabel || '',
      annotations: params.annotations || [],
      blurScore: analysis.blurScore,
    });
    await saveMediaBlob(item.id, activeDataset.id, params.blob);
  };

  const syncCountersAfterChange = async (addedCount: number, addedAnnotated: number) => {
    if (!activeDataset) return;
    await syncDatasetCounters({
      datasetId: activeDataset.id,
      imageCount: items.length + addedCount,
      annotatedCount:
        (qualityReport?.annotatedImages ?? 0) + addedAnnotated,
    });
  };

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || !activeDataset) return;
    setErrMsg(null);
    const validFiles = Array.from(files).filter((f) =>
      ALLOWED_IMAGE_MIMES.has(f.type)
    );
    if (validFiles.length === 0) {
      setErrMsg('Please select valid JPG, PNG, or WebP images.');
      return;
    }

    setBusyMsg(`Uploading ${validFiles.length} image(s)...`);
    try {
      let added = 0;
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        await ingestSingleBlob({
          blob: file,
          filename: file.name,
          mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
          sourceType: 'upload',
          index: items.length + i,
          total: items.length + validFiles.length,
        });
        added++;
      }
      await syncCountersAfterChange(added, 0);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setBusyMsg(null);
    }
  };

  const handleVideoExtract = async (files: FileList | null) => {
    if (!files || files.length === 0 || !activeDataset) return;
    const videoFile = files[0];
    setErrMsg(null);
    setBusyMsg('Extracting video frames...');
    try {
      const frames = await extractVideoFrames(
        videoFile,
        videoInterval,
        videoMaxFrames,
        (count) => setBusyMsg(`Extracted ${count} frame(s)...`)
      );
      for (let i = 0; i < frames.length; i++) {
        await ingestSingleBlob({
          blob: frames[i].blob,
          filename: frames[i].filename,
          mimeType: 'image/jpeg',
          sourceType: 'video_frame',
          index: items.length + i,
          total: items.length + frames.length,
        });
      }
      await syncCountersAfterChange(frames.length, 0);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Video extraction failed.');
    } finally {
      setBusyMsg(null);
    }
  };

  const startCamera = async (mode = facingMode) => {
    setErrMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrMsg('Camera API is unavailable in this browser.');
      return;
    }
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch (err) {
      setErrMsg(
        err instanceof Error
          ? `Camera access failed: ${err.message}`
          : 'Camera permission denied or device unavailable.'
      );
    }
  };

  const stopCamera = () => {
    if (burstTimerRef.current) {
      window.clearInterval(burstTimerRef.current);
      burstTimerRef.current = null;
    }
    setBurstRunning(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureCameraFrame = async () => {
    if (!videoRef.current || !activeDataset) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );
    if (!blob) return;

    const fname = `cam_${Date.now()}.jpg`;
    await ingestSingleBlob({
      blob,
      filename: fname,
      mimeType: 'image/jpeg',
      sourceType: 'camera',
      index: items.length,
      total: items.length + 1,
    });
    await syncCountersAfterChange(1, 0);
  };

  const toggleBurstCapture = () => {
    if (burstRunning) {
      if (burstTimerRef.current) window.clearInterval(burstTimerRef.current);
      burstTimerRef.current = null;
      setBurstRunning(false);
      return;
    }
    setBurstCount(0);
    setBurstRunning(true);
    burstTimerRef.current = window.setInterval(() => {
      void captureCameraFrame().then(() => setBurstCount((c) => c + 1));
    }, 900);
  };

  const handleImportYolo = async (files: FileList | null) => {
    if (!files || !activeDataset) return;
    setErrMsg(null);
    setBusyMsg('Importing YOLO dataset...');
    try {
      const fileArr = Array.from(files);
      const classesFile = fileArr.find((f) => f.name.toLowerCase() === 'classes.txt');
      let importedClasses = [...activeDataset.classes];
      if (classesFile) {
        const text = await classesFile.text();
        const parsedClasses = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (parsedClasses.length > 0) {
          importedClasses = Array.from(new Set([...importedClasses, ...parsedClasses])).slice(0, 50);
          await updateDatasetClassesAndMeta({
            datasetId: activeDataset.id,
            name: activeDataset.name,
            description: activeDataset.description,
            classes: importedClasses,
            version: activeDataset.version,
          });
        }
      }

      const labelMap = new Map<string, string>();
      for (const f of fileArr) {
        if (f.name.toLowerCase().endsWith('.txt') && f.name.toLowerCase() !== 'classes.txt') {
          const stem = f.name.replace(/\.[^.]+$/, '');
          labelMap.set(stem, await f.text());
        }
      }

      const imageFiles = fileArr.filter((f) => ALLOWED_IMAGE_MIMES.has(f.type));
      let addedAnnotated = 0;
      for (let i = 0; i < imageFiles.length; i++) {
        const imgFile = imageFiles[i];
        const stem = imgFile.name.replace(/\.[^.]+$/, '');
        const txt = labelMap.get(stem);
        const boxes = txt ? parseYoloLabels(txt, importedClasses) : [];
        if (boxes.length > 0) addedAnnotated++;

        await ingestSingleBlob({
          blob: imgFile,
          filename: imgFile.name,
          mimeType: imgFile.type as 'image/jpeg' | 'image/png' | 'image/webp',
          sourceType: 'import_yolo',
          index: items.length + i,
          total: items.length + imageFiles.length,
          annotations: boxes,
        });
      }
      await syncCountersAfterChange(imageFiles.length, addedAnnotated);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'YOLO import failed.');
    } finally {
      setBusyMsg(null);
    }
  };

  const handleImportCoco = async (files: FileList | null) => {
    if (!files || !activeDataset) return;
    setErrMsg(null);
    setBusyMsg('Importing COCO dataset...');
    try {
      const fileArr = Array.from(files);
      const jsonFile = fileArr.find((f) => f.name.toLowerCase().endsWith('.json'));
      if (!jsonFile) {
        throw new Error('Select a COCO .json annotation file along with matching images.');
      }
      const parsed = parseCocoJson(await jsonFile.text());
      const mergedClasses = Array.from(
        new Set([...activeDataset.classes, ...parsed.classes])
      ).slice(0, 50);

      await updateDatasetClassesAndMeta({
        datasetId: activeDataset.id,
        name: activeDataset.name,
        description: activeDataset.description,
        classes: mergedClasses,
        version: activeDataset.version,
      });

      const imageFiles = fileArr.filter((f) => ALLOWED_IMAGE_MIMES.has(f.type));
      let addedAnnotated = 0;
      for (let i = 0; i < imageFiles.length; i++) {
        const imgFile = imageFiles[i];
        const boxes = parsed.annotationsByFilename.get(imgFile.name) || [];
        if (boxes.length > 0) addedAnnotated++;
        await ingestSingleBlob({
          blob: imgFile,
          filename: imgFile.name,
          mimeType: imgFile.type as 'image/jpeg' | 'image/png' | 'image/webp',
          sourceType: 'import_coco',
          index: items.length + i,
          total: items.length + imageFiles.length,
          annotations: boxes,
        });
      }
      await syncCountersAfterChange(imageFiles.length, addedAnnotated);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'COCO import failed.');
    } finally {
      setBusyMsg(null);
    }
  };

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDataset) return;
    const clean = newClassInput.trim().slice(0, 80);
    if (!clean || activeDataset.classes.includes(clean)) return;
    await updateDatasetClassesAndMeta({
      datasetId: activeDataset.id,
      name: activeDataset.name,
      description: activeDataset.description,
      classes: [...activeDataset.classes, clean],
      version: activeDataset.version,
    });
    setNewClassInput('');
  };

  const handleRemoveClass = async (cls: string) => {
    if (!activeDataset) return;
    await updateDatasetClassesAndMeta({
      datasetId: activeDataset.id,
      name: activeDataset.name,
      description: activeDataset.description,
      classes: activeDataset.classes.filter((c) => c !== cls),
      version: activeDataset.version,
    });
  };

  const handleApplySplits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDataset) return;
    setErrMsg(null);
    if (trainPct + valPct + testPct !== 100) {
      setErrMsg(t.datasetStudio.splitSumError);
      return;
    }
    setBusyMsg('Updating dataset splits...');
    try {
      await updateDatasetSplits({
        datasetId: activeDataset.id,
        splitTrainPct: trainPct,
        splitValPct: valPct,
        splitTestPct: testPct,
      });
      const updates = items.map((item, idx) => ({
        itemId: item.id,
        split: assignSplitForIndex(idx, items.length, trainPct, valPct),
      }));
      await applyBulkItemSplits({ datasetId: activeDataset.id, updates });
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Split update failed.');
    } finally {
      setBusyMsg(null);
    }
  };

  const handleRemoveDuplicates = async () => {
    if (!activeDataset || !qualityReport) return;
    setBusyMsg('Removing duplicate copies...');
    try {
      let removed = 0;
      for (const group of qualityReport.duplicateGroups) {
        // Keep the first copy, remove subsequent duplicates
        for (const dupId of group.itemIds.slice(1)) {
          await deleteDatasetItem(activeDataset.id, dupId);
          removed++;
        }
      }
      await syncDatasetCounters({
        datasetId: activeDataset.id,
        imageCount: Math.max(0, items.length - removed),
        annotatedCount: Math.max(0, qualityReport.annotatedImages),
      });
    } finally {
      setBusyMsg(null);
    }
  };

  const handleSaveAugmentation = async () => {
    if (!activeDataset) return;
    setBusyMsg('Saving augmentation pipeline...');
    try {
      await updateDatasetAugmentation({
        datasetId: activeDataset.id,
        augmentationConfig: augCfg,
      });
    } finally {
      setBusyMsg(null);
    }
  };

  const handleMarkDatasetReady = async () => {
    if (!activeDataset) return;
    setBusyMsg('Updating project status...');
    try {
      await updateProjectDatasetState({
        projectId: project.id,
        datasetCount: datasets.length,
        status: 'dataset_ready',
      });
      await logActivity({
        ownerUid: project.ownerUid,
        projectId: project.id,
        action: 'dataset_updated',
        targetType: 'dataset',
        targetName: activeDataset.name,
      });
    } finally {
      setBusyMsg(null);
    }
  };

  // Empty state / Create first dataset
  if (datasets.length === 0 || showCreateForm) {
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 max-w-2xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-display font-bold">{t.datasetStudio.createTitle}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {t.datasetStudio.createSubtitle}
            </p>
          </div>
          {datasets.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {t.common.close}
            </button>
          )}
        </div>

        <form onSubmit={handleCreateDataset} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.datasetStudio.datasetName}
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={dsName}
              onChange={(e) => setDsName(e.target.value)}
              placeholder={t.datasetStudio.datasetNamePlaceholder}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.datasetStudio.datasetDesc}
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={dsDesc}
              onChange={(e) => setDsDesc(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.datasetStudio.initialClasses}
            </label>
            <input
              type="text"
              value={dsClassesInput}
              onChange={(e) => setDsClassesInput(e.target.value)}
              placeholder={t.datasetStudio.initialClassesHint}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          {errMsg && (
            <p className="text-xs text-red-600 dark:text-red-400">{errMsg}</p>
          )}

          <button
            type="submit"
            disabled={creatingDs}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {creatingDs ? t.datasetStudio.creatingBtn : t.datasetStudio.createBtn}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dataset Selector & Readiness Bar */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-white dark:bg-zinc-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t.datasetStudio.activeDataset}
          </span>
          <select
            value={activeDataset?.id || ''}
            onChange={(e) => onSelectDataset(e.target.value)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
          >
            {datasets.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name} (v{ds.version})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.datasetStudio.newDatasetBtn}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {project.status === 'dataset_ready' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>{t.datasetStudio.readyBadge}</span>
            </span>
          ) : (
            <button
              type="button"
              disabled={!activeDataset || items.length === 0}
              onClick={() => void handleMarkDatasetReady()}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
            >
              {t.datasetStudio.markReadyBtn}
            </button>
          )}
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 w-fit overflow-x-auto max-w-full">
        {(
          [
            { id: 'ingest', label: t.datasetStudio.subTabs.ingest },
            { id: 'classesSplits', label: t.datasetStudio.subTabs.classesSplits },
            { id: 'quality', label: t.datasetStudio.subTabs.quality },
            { id: 'augmentation', label: t.datasetStudio.subTabs.augmentation },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              subTab === tab.id
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {busyMsg && (
        <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-red-600" />
          <span>{busyMsg}</span>
        </div>
      )}

      {errMsg && (
        <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {errMsg}
        </div>
      )}

      {/* SUBTAB 1: COLLECT & IMPORT */}
      {subTab === 'ingest' && activeDataset && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Image Upload */}
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3">
              <div className="flex items-center gap-2 font-display font-semibold text-sm">
                <ImagePlus className="w-4 h-4 text-red-600 dark:text-red-500" />
                <h3>{t.datasetStudio.uploadImagesTitle}</h3>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t.datasetStudio.uploadImagesDesc}
              </p>
              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                <span>{t.datasetStudio.selectImagesBtn}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleImageUpload(e.target.files)}
                />
              </label>
            </div>

            {/* Video Frame Extraction */}
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3">
              <div className="flex items-center gap-2 font-display font-semibold text-sm">
                <Film className="w-4 h-4 text-red-600 dark:text-red-500" />
                <h3>{t.datasetStudio.uploadVideoTitle}</h3>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t.datasetStudio.uploadVideoDesc}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <span className="text-zinc-500">{t.datasetStudio.intervalLabel}</span>
                  <input
                    type="number"
                    min={0.25}
                    max={30}
                    step={0.25}
                    value={videoInterval}
                    onChange={(e) => setVideoInterval(Number(e.target.value) || 1)}
                    className="w-16 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-zinc-500">{t.datasetStudio.maxFramesLabel}</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={videoMaxFrames}
                    onChange={(e) => setVideoMaxFrames(Number(e.target.value) || 10)}
                    className="w-16 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 tabular-nums"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors">
                <Film className="w-3.5 h-3.5" />
                <span>{t.datasetStudio.extractFramesBtn}</span>
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => void handleVideoExtract(e.target.files)}
                />
              </label>
            </div>

            {/* Live Camera & Continuous Capture */}
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3">
              <div className="flex items-center gap-2 font-display font-semibold text-sm">
                <Camera className="w-4 h-4 text-red-600 dark:text-red-500" />
                <h3>{t.datasetStudio.cameraTitle}</h3>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t.datasetStudio.cameraDesc}
              </p>

              {!cameraActive ? (
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{t.datasetStudio.startCameraBtn}</span>
                </button>
              ) : (
                <div className="space-y-3">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full max-h-56 rounded-lg bg-black object-cover"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void captureCameraFrame()}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
                    >
                      {t.datasetStudio.captureSingleBtn}
                    </button>
                    <button
                      type="button"
                      onClick={toggleBurstCapture}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700"
                    >
                      {burstRunning
                        ? `${t.datasetStudio.stopBurstBtn} (${burstCount})`
                        : t.datasetStudio.startBurstBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = facingMode === 'environment' ? 'user' : 'environment';
                        setFacingMode(next);
                        void startCamera(next);
                      }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700"
                    >
                      {t.datasetStudio.switchCameraBtn}
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400"
                    >
                      {t.datasetStudio.stopCameraBtn}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Import & Export YOLO / COCO */}
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-3">
              <div className="flex items-center gap-2 font-display font-semibold text-sm">
                <Layers className="w-4 h-4 text-red-600 dark:text-red-500" />
                <h3>{t.datasetStudio.importTitle}</h3>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {t.datasetStudio.importDesc}
              </p>

              <div className="flex flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t.datasetStudio.importYoloBtn}</span>
                  <input
                    type="file"
                    multiple
                    accept=".txt,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void handleImportYolo(e.target.files)}
                  />
                </label>

                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t.datasetStudio.importCocoBtn}</span>
                  <input
                    type="file"
                    multiple
                    accept=".json,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void handleImportCoco(e.target.files)}
                  />
                </label>
              </div>

              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={items.length === 0}
                  onClick={() => {
                    const bundle = exportToYoloBundle(activeDataset, items);
                    downloadJsonFile(`${activeDataset.name}_yolo_bundle.json`, bundle);
                    void logActivity({
                      ownerUid: project.ownerUid,
                      projectId: project.id,
                      action: 'dataset_exported',
                      targetType: 'dataset',
                      targetName: `${activeDataset.name} (YOLO)`,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t.datasetStudio.exportYoloBtn}</span>
                </button>
                <button
                  type="button"
                  disabled={items.length === 0}
                  onClick={() => {
                    const coco = exportToCocoJson(activeDataset, items);
                    downloadJsonFile(`${activeDataset.name}_coco.json`, coco);
                    void logActivity({
                      ownerUid: project.ownerUid,
                      projectId: project.id,
                      action: 'dataset_exported',
                      targetType: 'dataset',
                      targetName: `${activeDataset.name} (COCO)`,
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t.datasetStudio.exportCocoBtn}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Media Library Grid */}
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-semibold">
                {t.datasetStudio.galleryTitle} ({items.length})
              </h3>
            </div>

            {items.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 py-4">
                {t.annotationStudio.noImagesDesc}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-950 flex flex-col"
                  >
                    <DatasetThumbnail itemId={item.id} alt={item.filename} />
                    <div className="p-2.5 space-y-1.5 text-[11px]">
                      <p className="font-medium truncate text-zinc-900 dark:text-zinc-100">
                        {item.filename}
                      </p>
                      <p className="text-zinc-500 tabular-nums">
                        {item.width}×{item.height} · {item.split.toUpperCase()}
                      </p>
                      <p className="text-zinc-500 truncate">
                        {project.taskType === 'image_classification'
                          ? item.classificationLabel || 'Unlabeled'
                          : `${item.annotations.length} box(es)`}
                      </p>
                      <div className="pt-1 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenAnnotator(item.id)}
                          className="text-red-600 dark:text-red-500 font-semibold hover:underline"
                        >
                          {t.datasetStudio.openInAnnotator}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void deleteDatasetItem(activeDataset.id, item.id).then(() =>
                              syncDatasetCounters({
                                datasetId: activeDataset.id,
                                imageCount: Math.max(0, items.length - 1),
                                annotatedCount: Math.max(
                                  0,
                                  (qualityReport?.annotatedImages ?? 1) -
                                    (item.classificationLabel || item.annotations.length > 0 ? 1 : 0)
                                ),
                              })
                            );
                          }}
                          className="text-zinc-400 hover:text-red-600"
                          aria-label={t.datasetStudio.deleteImage}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 2: CLASSES & SPLITS */}
      {subTab === 'classesSplits' && activeDataset && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
            <h3 className="text-base font-display font-semibold">
              {t.datasetStudio.classesTitle} ({activeDataset.classes.length}/50)
            </h3>

            <form onSubmit={handleAddClass} className="flex gap-2">
              <input
                type="text"
                maxLength={80}
                value={newClassInput}
                onChange={(e) => setNewClassInput(e.target.value)}
                placeholder={t.datasetStudio.addClassPlaceholder}
                className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 whitespace-nowrap"
              >
                {t.datasetStudio.addClassBtn}
              </button>
            </form>

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border-t border-zinc-100 dark:border-zinc-800">
              {activeDataset.classes.map((cls, idx) => (
                <div
                  key={cls}
                  className="py-2.5 flex items-center justify-between text-sm"
                >
                  <span className="font-medium">
                    <span className="text-zinc-400 font-mono me-2 tabular-nums">
                      {idx + 1}.
                    </span>
                    {cls}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveClass(cls)}
                    className="text-xs text-zinc-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleApplySplits}
            className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4 h-fit"
          >
            <h3 className="text-base font-display font-semibold">
              {t.datasetStudio.splitsTitle}
            </h3>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  {t.datasetStudio.trainSplit}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={trainPct}
                  onChange={(e) => setTrainPct(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  {t.datasetStudio.valSplit}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={valPct}
                  onChange={(e) => setValPct(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  {t.datasetStudio.testSplit}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={testPct}
                  onChange={(e) => setTestPct(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 tabular-nums"
                />
              </div>
            </div>

            {qualityReport && (
              <div className="text-xs text-zinc-500 tabular-nums flex items-center gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <span>Train: {qualityReport.splitCounts.train}</span>
                <span>Val: {qualityReport.splitCounts.val}</span>
                <span>Test: {qualityReport.splitCounts.test}</span>
              </div>
            )}

            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              {t.datasetStudio.applySplitsBtn}
            </button>
          </form>
        </div>
      )}

      {/* SUBTAB 3: DATA QUALITY AUDIT */}
      {subTab === 'quality' && qualityReport && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 divide-x rtl:divide-x-reverse divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            <div className="p-4">
              <span className="text-xs text-zinc-500">{t.datasetStudio.totalImages}</span>
              <p className="text-2xl font-display font-bold tabular-nums mt-1">
                {qualityReport.totalImages}
              </p>
            </div>
            <div className="p-4">
              <span className="text-xs text-zinc-500">{t.datasetStudio.annotatedImages}</span>
              <p className="text-2xl font-display font-bold tabular-nums mt-1">
                {qualityReport.annotatedImages}
              </p>
            </div>
            <div className="p-4">
              <span className="text-xs text-zinc-500">{t.datasetStudio.approvedImages}</span>
              <p className="text-2xl font-display font-bold tabular-nums mt-1">
                {qualityReport.approvedImages}
              </p>
            </div>
            <div className="p-4">
              <span className="text-xs text-zinc-500">{t.datasetStudio.imbalanceRatio}</span>
              <p className="text-2xl font-display font-bold tabular-nums mt-1">
                {qualityReport.imbalanceRatio !== null ? `${qualityReport.imbalanceRatio}×` : '—'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
              <h3 className="text-base font-display font-semibold">
                {t.datasetStudio.qualityTitle}
              </h3>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
                <div className="py-3 flex items-center justify-between gap-4">
                  <span>{t.datasetStudio.duplicatesLabel}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold tabular-nums">
                      {qualityReport.duplicateGroups.length}
                    </span>
                    {qualityReport.duplicateGroups.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveDuplicates()}
                        className="text-red-600 dark:text-red-500 font-semibold hover:underline"
                      >
                        {t.datasetStudio.removeDuplicatesBtn}
                      </button>
                    )}
                  </div>
                </div>

                <div className="py-3 flex items-center justify-between">
                  <span>{t.datasetStudio.missingAnnotationsLabel}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {qualityReport.missingAnnotationIds.length}
                  </span>
                </div>

                <div className="py-3 flex items-center justify-between">
                  <span>{t.datasetStudio.invalidAnnotationsLabel}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {qualityReport.invalidAnnotationIds.length}
                  </span>
                </div>

                <div className="py-3 flex items-center justify-between">
                  <span>{t.datasetStudio.lowResLabel}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {qualityReport.lowResolutionIds.length}
                  </span>
                </div>

                <div className="py-3 flex items-center justify-between">
                  <span>{t.datasetStudio.blurryLabel}</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {qualityReport.blurryImageIds.length}
                  </span>
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-display font-semibold">
                  {t.datasetStudio.classDistribution}
                </h3>
                {qualityReport.imbalanceRatio !== null && qualityReport.imbalanceRatio > 3 && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Imbalanced
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {Object.entries(qualityReport.classCounts).map(([cls, count]) => {
                  const maxVal = Math.max(
                    1,
                    ...Object.values(qualityReport.classCounts)
                  );
                  const pct = Math.round((count / maxVal) * 100);
                  return (
                    <div key={cls} className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="font-medium">{cls}</span>
                        <span className="font-mono tabular-nums">{count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-red-600 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 4: DATA AUGMENTATION */}
      {subTab === 'augmentation' && activeDataset && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-5">
            <div>
              <h3 className="text-base font-display font-semibold flex items-center gap-2">
                <Sliders className="w-4 h-4 text-red-600 dark:text-red-500" />
                <span>{t.datasetStudio.augmentationTitle}</span>
              </h3>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1.5 leading-relaxed">
                {t.datasetStudio.augmentationLeakageRule}
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <label className="block space-y-1">
                <div className="flex justify-between">
                  <span>{t.datasetStudio.rotateLabel}</span>
                  <span className="font-mono tabular-nums">{augCfg.rotateDeg}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={180}
                  value={augCfg.rotateDeg}
                  onChange={(e) =>
                    setAugCfg({ ...augCfg, rotateDeg: Number(e.target.value) })
                  }
                  className="w-full accent-red-600"
                />
              </label>

              <div className="flex flex-wrap gap-6">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={augCfg.flipHorizontal}
                    onChange={(e) =>
                      setAugCfg({ ...augCfg, flipHorizontal: e.target.checked })
                    }
                    className="accent-red-600"
                  />
                  <span>{t.datasetStudio.flipHLabel}</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={augCfg.flipVertical}
                    onChange={(e) =>
                      setAugCfg({ ...augCfg, flipVertical: e.target.checked })
                    }
                    className="accent-red-600"
                  />
                  <span>{t.datasetStudio.flipVLabel}</span>
                </label>
              </div>

              <label className="block space-y-1">
                <div className="flex justify-between">
                  <span>{t.datasetStudio.brightnessLabel}</span>
                  <span className="font-mono tabular-nums">+{augCfg.brightnessDelta}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={80}
                  value={augCfg.brightnessDelta}
                  onChange={(e) =>
                    setAugCfg({ ...augCfg, brightnessDelta: Number(e.target.value) })
                  }
                  className="w-full accent-red-600"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between">
                  <span>{t.datasetStudio.contrastLabel}</span>
                  <span className="font-mono tabular-nums">+{augCfg.contrastDelta}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={80}
                  value={augCfg.contrastDelta}
                  onChange={(e) =>
                    setAugCfg({ ...augCfg, contrastDelta: Number(e.target.value) })
                  }
                  className="w-full accent-red-600"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between">
                  <span>{t.datasetStudio.noiseLabel}</span>
                  <span className="font-mono tabular-nums">{augCfg.noiseLevel}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={augCfg.noiseLevel}
                  onChange={(e) =>
                    setAugCfg({ ...augCfg, noiseLevel: Number(e.target.value) })
                  }
                  className="w-full accent-red-600"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between">
                  <span>{t.datasetStudio.blurLabel}</span>
                  <span className="font-mono tabular-nums">{augCfg.blurRadius}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={0.5}
                  value={augCfg.blurRadius}
                  onChange={(e) =>
                    setAugCfg({ ...augCfg, blurRadius: Number(e.target.value) })
                  }
                  className="w-full accent-red-600"
                />
              </label>

              <div>
                <span className="block mb-1">{t.datasetStudio.resizeLabel}</span>
                <select
                  value={`${augCfg.resizeWidth}x${augCfg.resizeHeight}`}
                  onChange={(e) => {
                    const [w, h] = e.target.value.split('x').map(Number);
                    setAugCfg({ ...augCfg, resizeWidth: w, resizeHeight: h });
                  }}
                  className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono"
                >
                  <option value="224x224">224 × 224</option>
                  <option value="320x320">320 × 320</option>
                  <option value="640x640">640 × 640</option>
                  <option value="1024x1024">1024 × 1024</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSaveAugmentation()}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              {t.datasetStudio.saveAugBtn}
            </button>
          </div>

          <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900 space-y-4">
            <h3 className="text-sm font-display font-semibold">
              {t.datasetStudio.previewLabel}
            </h3>
            {items.length === 0 ? (
              <p className="text-xs text-zinc-500">{t.annotationStudio.noImagesDesc}</p>
            ) : (
              <canvas
                ref={previewCanvasRef}
                width={420}
                height={320}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-950"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
