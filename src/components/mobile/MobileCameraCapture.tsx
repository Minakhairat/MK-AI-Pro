import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Crop,
  Film,
  ImagePlus,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  SwitchCamera,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import {
  ALLOWED_IMAGE_MIMES,
  analyzeImageBlob,
  extractVideoFrames,
  pickIncrementalSplit,
} from '../../lib/datasetUtils';
import { saveMediaBlob } from '../../lib/localMediaStore';
import { enqueueOfflineSyncAction } from '../../lib/mobileOfflineStore';
import {
  addDatasetItem,
  syncDatasetCounters,
  updateDatasetClassesAndMeta,
} from '../../services/firestoreService';
import type { Dataset, DatasetItem, DatasetSourceType, Project } from '../../types/domain';

interface MobileCameraCaptureProps {
  project: Project;
  dataset: Dataset;
  items: DatasetItem[];
  isOnline: boolean;
  onItemSaved?: (source: 'synced' | 'cached_offline') => void;
}

type CropPreset = 'original' | 'square' | '4:3';

interface StagedImage {
  id: string;
  filename: string;
  sourceType: DatasetSourceType;
  blob: Blob;
  previewUrl: string;
  rotationDeg: number;
  cropPreset: CropPreset;
}

async function applyCanvasTransforms(
  blob: Blob,
  rotationDeg: number,
  cropPreset: CropPreset
): Promise<Blob> {
  if (rotationDeg % 360 === 0 && cropPreset === 'original') {
    return blob;
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image for editing.'));
      el.src = url;
    });

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    const rot = ((rotationDeg % 360) + 360) % 360;
    const rotatedW = rot === 90 || rot === 270 ? sh : sw;
    const rotatedH = rot === 90 || rot === 270 ? sw : sh;

    // Step 1: Rotate onto intermediate canvas
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotatedW;
    rotCanvas.height = rotatedH;
    const rCtx = rotCanvas.getContext('2d');
    if (!rCtx) return blob;
    rCtx.translate(rotatedW / 2, rotatedH / 2);
    rCtx.rotate((rot * Math.PI) / 180);
    rCtx.drawImage(img, -sw / 2, -sh / 2);

    // Step 2: Apply center crop preset if selected
    let outW = rotatedW;
    let outH = rotatedH;
    if (cropPreset === 'square') {
      const side = Math.min(rotatedW, rotatedH);
      outW = side;
      outH = side;
    } else if (cropPreset === '4:3') {
      if (rotatedW / rotatedH > 4 / 3) {
        outH = rotatedH;
        outW = Math.round((rotatedH * 4) / 3);
      } else {
        outW = rotatedW;
        outH = Math.round((rotatedW * 3) / 4);
      }
    }

    const sx = Math.max(0, Math.round((rotatedW - outW) / 2));
    const sy = Math.max(0, Math.round((rotatedH - outH) / 2));

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const oCtx = outCanvas.getContext('2d');
    if (!oCtx) return blob;
    oCtx.drawImage(rotCanvas, sx, sy, outW, outH, 0, 0, outW, outH);

    const outBlob = await new Promise<Blob | null>((resolve) =>
      outCanvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    return outBlob || blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MobileCameraCapture({
  project,
  dataset,
  items,
  isOnline,
  onItemSaved,
}: MobileCameraCaptureProps) {
  const { user } = useAuth();
  const { locale } = useI18n();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);

  const [selectedClass, setSelectedClass] = useState<string>(dataset.classes[0] || '');
  const [newClassText, setNewClassText] = useState('');
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [cloudConsentOverride, setCloudConsentOverride] = useState(project.cloudConsentGranted);

  useEffect(() => {
    setCloudConsentOverride(project.cloudConsentGranted);
  }, [project.id, project.cloudConsentGranted]);

  useEffect(() => {
    if (dataset.classes.length > 0 && !dataset.classes.includes(selectedClass)) {
      setSelectedClass(dataset.classes[0]);
    }
  }, [dataset.classes, selectedClass]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  const stopCamera = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    setRecordingVideo(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const startCamera = async (mode: 'environment' | 'user' = facingMode) => {
    setErrorMsg(null);
    setPermissionDenied(false);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(
        locale === 'ar'
          ? 'الكاميرا غير مدعومة في هذا المتصفح. استخدم رفع الصور.'
          : 'Camera API unavailable in this browser. Use gallery upload instead.'
      );
      return;
    }
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setFacingMode(mode);
      setCameraActive(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      }, 40);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/denied|permission|notallowed/i.test(msg)) {
        setPermissionDenied(true);
      }
      setErrorMsg(
        locale === 'ar'
          ? 'تعذر فتح الكاميرا. تأكد من منح إذن الكاميرا في إعدادات المتصفح.'
          : 'Unable to open camera. Grant camera permission in browser settings and retry.'
      );
    }
  };

  const handleCapturePhoto = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) return;

    const previewUrl = URL.createObjectURL(blob);
    setStaged((prev) => [
      {
        id: `cap_${Date.now().toString(36)}`,
        filename: `mobile_cam_${Date.now()}.jpg`,
        sourceType: 'camera',
        blob,
        previewUrl,
        rotationDeg: 0,
        cropPreset: 'original',
      },
      ...prev,
    ]);
  };

  const handleToggleVideoRecord = () => {
    if (!streamRef.current) return;
    if (recordingVideo && recorderRef.current) {
      recorderRef.current.stop();
      setRecordingVideo(false);
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      setErrorMsg(
        locale === 'ar'
          ? 'تسجيل الفيديو غير مدعوم على هذا الجهاز.'
          : 'MediaRecorder video capture is unavailable on this browser.'
      );
      return;
    }

    try {
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(streamRef.current);
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        const videoBlob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        if (videoBlob.size === 0) return;
        const file = new File([videoBlob], `clip_${Date.now()}.webm`, { type: 'video/webm' });
        try {
          setStatusMsg(locale === 'ar' ? 'جارٍ استخراج الإطارات...' : 'Extracting video frames...');
          const frames = await extractVideoFrames(file, 0.75, 8);
          setStaged((prev) => [
            ...frames.map((f, i) => ({
              id: `vid_${Date.now().toString(36)}_${i}`,
              filename: f.filename,
              sourceType: 'video_frame' as DatasetSourceType,
              blob: f.blob,
              previewUrl: URL.createObjectURL(f.blob),
              rotationDeg: 0,
              cropPreset: 'original' as CropPreset,
            })),
            ...prev,
          ]);
          setStatusMsg(
            locale === 'ar'
              ? `تم استخراج ${frames.length} إطار من الفيديو للمراجعة.`
              : `Extracted ${frames.length} video frame(s) for review.`
          );
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Frame extraction failed.');
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecordingVideo(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not start recording.');
    }
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    const next: StagedImage[] = [];
    for (const file of Array.from(files).slice(0, 20)) {
      if (!ALLOWED_IMAGE_MIMES.has(file.type)) continue;
      next.push({
        id: `upl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        filename: file.name,
        sourceType: 'upload',
        blob: file,
        previewUrl: URL.createObjectURL(file),
        rotationDeg: 0,
        cropPreset: 'original',
      });
    }
    if (next.length === 0) {
      setErrorMsg(
        locale === 'ar'
          ? 'يرجى اختيار صور بصيغة JPG أو PNG أو WEBP.'
          : 'Please choose valid JPG, PNG, or WEBP images.'
      );
      return;
    }
    setStaged((prev) => [...next, ...prev]);
  };

  const handleAddClass = async () => {
    const clean = newClassText.trim().slice(0, 60);
    if (!clean) return;
    if (dataset.classes.includes(clean)) {
      setSelectedClass(clean);
      setNewClassText('');
      return;
    }
    try {
      await updateDatasetClassesAndMeta({
        datasetId: dataset.id,
        name: dataset.name,
        description: dataset.description,
        classes: [...dataset.classes, clean],
        version: dataset.version,
      });
      setSelectedClass(clean);
      setNewClassText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not add class.');
    }
  };

  const updateStagedEdit = (id: string, patch: Partial<StagedImage>) => {
    setStaged((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeStaged = (id: string) => {
    setStaged((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
  };

  const handleCommitAll = async () => {
    if (!user || staged.length === 0) return;
    if (project.storageLocation === 'cloud' && !cloudConsentOverride) {
      setErrorMsg(
        locale === 'ar'
          ? 'يرجى تأكيد الموافقة على رفع البيانات قبل المزامنة السحابية.'
          : 'Confirm cloud upload consent below before syncing dataset samples.'
      );
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);

    try {
      let syncedCount = 0;
      let queuedCount = 0;
      const workingItems = [...items];

      for (const entry of staged) {
        const finalBlob = await applyCanvasTransforms(
          entry.blob,
          entry.rotationDeg,
          entry.cropPreset
        );
        const analysis = await analyzeImageBlob(finalBlob);
        const split = pickIncrementalSplit(
          workingItems,
          selectedClass,
          dataset.splitTrainPct,
          dataset.splitValPct,
          project.taskType
        );
        const clsLabel =
          project.taskType === 'image_classification' ? selectedClass : '';

        if (isOnline) {
          const savedItem = await addDatasetItem({
            datasetId: dataset.id,
            projectId: project.id,
            ownerUid: user.uid,
            filename: entry.filename,
            mimeType: 'image/jpeg',
            width: analysis.width,
            height: analysis.height,
            sizeBytes: finalBlob.size,
            sha256: analysis.sha256,
            sourceType: entry.sourceType,
            split,
            classificationLabel: clsLabel,
            annotations: [],
            blurScore: analysis.blurScore,
            isApproved: Boolean(clsLabel),
          });
          await saveMediaBlob(savedItem.id, dataset.id, finalBlob);
          workingItems.push(savedItem);
          syncedCount += 1;
        } else {
          const localItemId = `offline_${Date.now().toString(36)}_${Math.random()
            .toString(36)
            .slice(2, 6)}`;
          await saveMediaBlob(localItemId, dataset.id, finalBlob);
          await enqueueOfflineSyncAction({
            type: 'upload_dataset_item',
            projectId: project.id,
            datasetId: dataset.id,
            itemId: localItemId,
            storageLocation: project.storageLocation,
            cloudConsentGranted: cloudConsentOverride,
            payload: {
              datasetId: dataset.id,
              projectId: project.id,
              ownerUid: user.uid,
              itemId: localItemId,
              filename: entry.filename,
              mimeType: 'image/jpeg',
              width: analysis.width,
              height: analysis.height,
              sizeBytes: finalBlob.size,
              sha256: analysis.sha256,
              sourceType: entry.sourceType,
              split,
              classificationLabel: clsLabel,
              annotations: [],
              blurScore: analysis.blurScore,
              isApproved: Boolean(clsLabel),
              totalItemsHint: workingItems.length + 1,
              annotatedCountHint: workingItems.filter((it) =>
                project.taskType === 'image_classification'
                  ? Boolean(it.classificationLabel)
                  : it.annotations.length > 0
              ).length + (clsLabel ? 1 : 0),
            },
          });
          queuedCount += 1;
        }
        URL.revokeObjectURL(entry.previewUrl);
      }

      if (syncedCount > 0 && isOnline) {
        const annotatedCount = workingItems.filter((it) =>
          project.taskType === 'image_classification'
            ? Boolean(it.classificationLabel)
            : it.annotations.length > 0
        ).length;
        await syncDatasetCounters({
          datasetId: dataset.id,
          imageCount: workingItems.length,
          annotatedCount,
        });
      }

      setStaged([]);
      if (queuedCount > 0) {
        setStatusMsg(
          locale === 'ar'
            ? `تم حفظ ${queuedCount} صورة محلياً في قائمة المزامنة (أوفلاين).`
            : `Saved ${queuedCount} image(s) privately offline in sync queue.`
        );
        onItemSaved?.('cached_offline');
      } else {
        setStatusMsg(
          locale === 'ar'
            ? `تم حفظ ومزامنة ${syncedCount} صورة بنجاح.`
            : `Saved & synced ${syncedCount} image(s) to dataset.`
        );
        onItemSaved?.('synced');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save captured images.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Camera Viewport or Lazy Activation Card */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 overflow-hidden">
        {cameraActive ? (
          <div className="relative">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full max-h-[340px] object-cover bg-black"
            />
            <div className="p-3 bg-zinc-950/90 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  void startCamera(facingMode === 'environment' ? 'user' : 'environment')
                }
                className="min-h-[44px] min-w-[44px] px-3 rounded-lg border border-zinc-700 text-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <SwitchCamera className="w-4 h-4" />
                <span>{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleCapturePhoto()}
                className="min-h-[48px] px-5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-2"
              >
                <Camera className="w-4 h-4" />
                <span>{locale === 'ar' ? 'التقاط صورة' : 'Capture'}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleVideoRecord}
                className={`min-h-[44px] min-w-[44px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                  recordingVideo
                    ? 'bg-amber-600 text-white'
                    : 'border border-zinc-700 text-zinc-200'
                }`}
              >
                {recordingVideo ? <Film className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                <span>{recordingVideo ? (locale === 'ar' ? 'إيقاف' : 'Stop') : 'Clip'}</span>
              </button>

              <button
                type="button"
                onClick={stopCamera}
                aria-label={locale === 'ar' ? 'إغلاق الكاميرا' : 'Close camera'}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 text-center space-y-3 bg-zinc-50 dark:bg-zinc-900">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {locale === 'ar'
                ? 'التقاط بالكاميرا أو اختيار صور من الهاتف'
                : 'Mobile Camera & Gallery Ingestion'}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {locale === 'ar'
                ? 'الكاميرا تُفعّل فقط عند الضغط. يمكنك التدوير والقص قبل الحفظ.'
                : 'Camera activates only on tap. Rotate and crop samples before saving.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void startCamera(facingMode)}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-2"
              >
                <Camera className="w-4 h-4" />
                <span>{locale === 'ar' ? 'تفعيل الكاميرا' : 'Enable Camera'}</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-2"
              >
                <ImagePlus className="w-4 h-4" />
                <span>{locale === 'ar' ? 'اختيار صور' : 'Choose Photos'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => handleFilesSelected(e.target.files)}
                className="hidden"
              />
            </div>

            {permissionDenied && (
              <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 space-y-2 text-start">
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>
                    {locale === 'ar' ? 'تم رفض إذن الكاميرا' : 'Camera permission blocked'}
                  </span>
                </div>
                <p>
                  {locale === 'ar'
                    ? 'افتح إعدادات الموقع في المتصفح ثم فعّل إذن الكاميرا، أو استخدم زر اختيار الصور أعلاه.'
                    : 'Open Site Settings in Android Chrome or iOS Safari Settings to allow Camera access, or use Choose Photos above.'}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera(facingMode)}
                  className="min-h-[44px] px-3 rounded-lg border border-amber-400 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{locale === 'ar' ? 'إعادة المحاولة' : 'Retry Camera'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Target Class Selection & Quick Class Add */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {project.taskType === 'image_classification'
              ? locale === 'ar'
                ? 'التصنيف الافتراضي للصور الجديدة'
                : 'Target Class for New Captures'
              : locale === 'ar'
              ? 'الفئات المتاحة'
              : 'Available Classes'}
          </span>
          <span className="text-[11px] font-mono text-zinc-500">
            {dataset.classes.length}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {dataset.classes.map((cls) => (
            <button
              key={cls}
              type="button"
              onClick={() => setSelectedClass(cls)}
              className={`min-h-[44px] px-3.5 rounded-lg text-xs font-semibold border transition-colors ${
                selectedClass === cls
                  ? 'bg-red-600 text-white border-red-600'
                  : 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {cls}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newClassText}
            onChange={(e) => setNewClassText(e.target.value)}
            placeholder={locale === 'ar' ? 'أضف فئة جديدة...' : 'New class name...'}
            className="flex-1 min-h-[44px] px-3 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
          />
          <button
            type="button"
            onClick={() => void handleAddClass()}
            className="min-h-[44px] px-3.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-semibold inline-flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            <span>{locale === 'ar' ? 'إضافة' : 'Add'}</span>
          </button>
        </div>
      </div>

      {/* Staged Captures Preview + Rotate / Crop Editor */}
      {staged.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {locale === 'ar'
                ? `الصور الجاهزة للحفظ (${staged.length})`
                : `Review Queue (${staged.length})`}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {staged.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 overflow-hidden"
              >
                <div className="relative h-44 bg-black flex items-center justify-center overflow-hidden">
                  <img
                    src={item.previewUrl}
                    alt={item.filename}
                    style={{ transform: `rotate(${item.rotationDeg}deg)` }}
                    className={`max-h-full max-w-full transition-transform ${
                      item.cropPreset === 'square'
                        ? 'aspect-square object-cover w-40 h-40'
                        : item.cropPreset === '4:3'
                        ? 'aspect-[4/3] object-cover'
                        : 'object-contain'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => removeStaged(item.id)}
                    aria-label="Remove"
                    className="absolute top-2 end-2 min-w-[44px] min-h-[44px] rounded-lg bg-zinc-950/80 text-white inline-flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-2.5 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      updateStagedEdit(item.id, { rotationDeg: (item.rotationDeg + 90) % 360 })
                    }
                    className="min-h-[44px] flex-1 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 inline-flex items-center justify-center gap-1.5 font-semibold"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{item.rotationDeg}°</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const nextPreset: CropPreset =
                        item.cropPreset === 'original'
                          ? 'square'
                          : item.cropPreset === 'square'
                          ? '4:3'
                          : 'original';
                      updateStagedEdit(item.id, { cropPreset: nextPreset });
                    }}
                    className="min-h-[44px] flex-1 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 inline-flex items-center justify-center gap-1.5 font-semibold"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>{item.cropPreset}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {project.storageLocation === 'cloud' && !project.cloudConsentGranted && (
            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 text-xs">
              <input
                type="checkbox"
                checked={cloudConsentOverride}
                onChange={(e) => setCloudConsentOverride(e.target.checked)}
                className="mt-0.5 accent-red-600 w-4 h-4"
              />
              <span>
                {locale === 'ar'
                  ? 'أوافق صراحةً على رفع هذه الصور إلى مساحة العمل السحابية الخاصة بي.'
                  : 'I explicitly consent to uploading these private photos to my cloud workspace.'}
              </span>
            </label>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleCommitAll()}
            className="w-full min-h-[48px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>
              {saving
                ? locale === 'ar'
                  ? 'جارٍ الحفظ...'
                  : 'Saving...'
                : isOnline
                ? locale === 'ar'
                  ? `حفظ ${staged.length} صورة في مجموعة البيانات`
                  : `Save ${staged.length} Sample(s) to Dataset`
                : locale === 'ar'
                ? `حفظ ${staged.length} صورة أوفلاين (للمزامنة لاحقاً)`
                : `Save ${staged.length} Sample(s) Offline Queue`}
            </span>
          </button>
        </div>
      )}

      {statusMsg && (
        <div className="p-3 rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-400">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
