import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Download,
  FileCode2,
  FileSpreadsheet,
  Film,
  Maximize2,
  Minimize2,
  Monitor,
  Plus,
  Save,
  Smartphone,
  Square,
  Tablet,
  Trash2,
  Upload,
} from 'lucide-react';
import { useI18n } from '../../contexts/I18nContext';
import {
  buildAppIconSvg,
  buildPwaManifestJson,
  buildPwaReadme,
  buildServiceWorkerJs,
  buildStandaloneHtmlApp,
  isValidCustomIconDataUrl,
} from '../../lib/appPackager';
import {
  getStoredModelRecord,
  listStoredModelKeys,
  loadTfModelFromIndexedDb,
} from '../../lib/localModelStore';
import { predictImageWithLocalModel } from '../../lib/tfTrainer';
import {
  createGeneratedApp,
  deleteGeneratedApp,
  logActivity,
  updateGeneratedApp,
} from '../../services/firestoreService';
import type {
  AppInputSource,
  AppRuntimeTarget,
  AppTier,
  GeneratedApp,
  InferencePrediction,
  Project,
  ThemeMode,
  TrainedModel,
} from '../../types/domain';

interface AppBuilderStudioProps {
  project: Project;
  trainedModels: TrainedModel[];
  generatedApps: GeneratedApp[];
  onOpenTraining: () => void;
}

interface InspectionHistoryRow {
  id: string;
  timestamp: string;
  source: AppInputSource;
  topLabel: string;
  confidence: number;
  latencyMs: number;
  alertTriggered: boolean;
}

const ACCENT_PRESETS = ['#DC2626', '#0F172A', '#059669', '#2563EB', '#D97706'];

function triggerTextDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvCell(value: string | number | boolean): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function triggerDataUrlDownload(filename: string, dataUrl: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

async function resizeIconFileToDataUrl(file: File): Promise<string> {
  const objUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode selected icon image.'));
      el.src = objUrl;
    });
    const size = 192;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }
    const iw = img.naturalWidth || img.width || size;
    const ih = img.naturalHeight || img.height || size;
    const scale = Math.min(size / iw, size / ih);
    const dw = Math.round(iw * scale);
    const dh = Math.round(ih * scale);
    const dx = Math.round((size - dw) / 2);
    const dy = Math.round((size - dh) / 2);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, dx, dy, dw, dh);

    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > 145000) {
      dataUrl = canvas.toDataURL('image/webp', 0.85);
    }
    if (dataUrl.length > 145000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    }
    if (!isValidCustomIconDataUrl(dataUrl)) {
      throw new Error('Processed icon exceeds size limits (150 KB max). Choose a simpler image.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mk-vision-app'
  );
}

export function AppBuilderStudio({
  project,
  trainedModels,
  generatedApps,
  onOpenTraining,
}: AppBuilderStudioProps) {
  const { t, locale } = useI18n();

  const defaultModel = useMemo(
    () => trainedModels.find((m) => m.isActive) || trainedModels[0] || null,
    [trainedModels]
  );

  // Active saved app selection or "new draft"
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  // Draft form state
  const [tier, setTier] = useState<AppTier>('custom');
  const [appName, setAppName] = useState<string>(() => `${project.name} App`.slice(0, 80));
  const [shortName, setShortName] = useState<string>(() =>
    project.name.replace(/\s+/g, '').slice(0, 12) || 'MKVision'
  );
  const [customHeaderTitle, setCustomHeaderTitle] = useState<string>('');
  const [description, setDescription] = useState<string>(project.description || '');
  const [themeColor, setThemeColor] = useState<string>('#DC2626');
  const [backgroundColor, setBackgroundColor] = useState<ThemeMode>('dark');
  const [selectedModelId, setSelectedModelId] = useState<string>(() => defaultModel?.id || '');
  const [runtimeTarget, setRuntimeTarget] = useState<AppRuntimeTarget>('on_device_pwa');
  const [inputSources, setInputSources] = useState<AppInputSource[]>(['upload', 'camera']);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.35);
  const [iouThreshold, setIouThreshold] = useState<number>(0.5);
  const [showConfidence, setShowConfidence] = useState<boolean>(true);
  const [showLatency, setShowLatency] = useState<boolean>(true);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [allowCsvExport, setAllowCsvExport] = useState<boolean>(false);
  const [alertEnabled, setAlertEnabled] = useState<boolean>(false);
  const [alertTargetClass, setAlertTargetClass] = useState<string>('');
  const [alertMinConfidence, setAlertMinConfidence] = useState<number>(0.75);
  const [customIconDataUrl, setCustomIconDataUrl] = useState<string>('');

  // Firestore mutation state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Local TF.js model weights verification & loaded instance
  const [storedKeys, setStoredKeys] = useState<Set<string>>(new Set());
  const loadedTfModelRef = useRef<{ modelId: string; model: tf.LayersModel } | null>(null);

  // Preview Runner state
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [standaloneFullscreen, setStandaloneFullscreen] = useState(false);
  const [lastPrediction, setLastPrediction] = useState<InferencePrediction | null>(null);
  const [alertTriggered, setAlertTriggered] = useState(false);
  const [historyRows, setHistoryRows] = useState<InspectionHistoryRow[]>([]);
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const videoObjectUrlRef = useRef<string | null>(null);
  const busyInferRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const iconInputRef = useRef<HTMLInputElement | null>(null);

  const selectedModel = useMemo(
    () => trainedModels.find((m) => m.id === selectedModelId) || defaultModel || null,
    [trainedModels, selectedModelId, defaultModel]
  );

  const activeSavedApp = useMemo(
    () => generatedApps.find((a) => a.id === selectedAppId) || null,
    [generatedApps, selectedAppId]
  );

  const refreshStoredKeys = useCallback(async () => {
    try {
      const keys = await listStoredModelKeys();
      setStoredKeys(keys);
    } catch {
      setStoredKeys(new Set());
    }
  }, []);

  useEffect(() => {
    void refreshStoredKeys();
  }, [refreshStoredKeys, trainedModels.length]);

  useEffect(() => {
    if (!selectedModelId && defaultModel) {
      setSelectedModelId(defaultModel.id);
    }
  }, [selectedModelId, defaultModel]);

  useEffect(() => {
    if (selectedModel && !selectedModel.onDeviceCompatible && runtimeTarget === 'on_device_pwa') {
      setRuntimeTarget('hybrid_cloud');
    }
    if (selectedModel && (!alertTargetClass || !selectedModel.classes.includes(alertTargetClass))) {
      setAlertTargetClass(selectedModel.classes[0] || '');
    }
  }, [selectedModel, runtimeTarget, alertTargetClass]);

  // Select first saved app on initial mount if none chosen
  useEffect(() => {
    if (generatedApps.length > 0 && selectedAppId === null) {
      loadAppIntoForm(generatedApps[0]);
    }
  }, [generatedApps.length]);

  const loadAppIntoForm = (app: GeneratedApp) => {
    setSelectedAppId(app.id);
    setTier(app.tier);
    setAppName(app.name);
    setShortName(app.shortName);
    setCustomHeaderTitle(app.customHeaderTitle);
    setDescription(app.description);
    setThemeColor(app.themeColor);
    setBackgroundColor(app.backgroundColor);
    setSelectedModelId(app.modelId);
    setRuntimeTarget(app.runtimeTarget);
    setInputSources(app.inputSources);
    setConfidenceThreshold(app.confidenceThreshold);
    setIouThreshold(app.iouThreshold);
    setShowConfidence(app.showConfidence);
    setShowLatency(app.showLatency);
    setShowHistory(app.showHistory);
    setAllowCsvExport(app.allowCsvExport);
    setAlertEnabled(app.alertEnabled);
    setAlertTargetClass(app.alertTargetClass);
    setAlertMinConfidence(app.alertMinConfidence);
    setCustomIconDataUrl(app.customIconDataUrl || '');
    setConfirmDelete(false);
    setStatusNotice(null);
    setErrorNotice(null);
  };

  const resetToNewAppDraft = () => {
    setSelectedAppId('');
    setTier('custom');
    setAppName(`${project.name} App`.slice(0, 80));
    setShortName(project.name.replace(/\s+/g, '').slice(0, 12) || 'MKVision');
    setCustomHeaderTitle('');
    setDescription(project.description || '');
    setThemeColor('#DC2626');
    setBackgroundColor('dark');
    if (defaultModel) {
      setSelectedModelId(defaultModel.id);
      setRuntimeTarget(defaultModel.onDeviceCompatible ? 'on_device_pwa' : 'hybrid_cloud');
      setAlertTargetClass(defaultModel.classes[0] || '');
    }
    setInputSources(['upload', 'camera']);
    setConfidenceThreshold(0.35);
    setIouThreshold(0.5);
    setShowConfidence(true);
    setShowLatency(true);
    setShowHistory(false);
    setAllowCsvExport(false);
    setAlertEnabled(false);
    setAlertMinConfidence(0.75);
    setCustomIconDataUrl('');
    setConfirmDelete(false);
    setStatusNotice(null);
    setErrorNotice(null);
  };

  const applyTierPreset = (nextTier: AppTier) => {
    setTier(nextTier);
    if (nextTier === 'basic') {
      setInputSources(['upload', 'camera']);
      setShowConfidence(true);
      setShowLatency(false);
      setShowHistory(false);
      setAllowCsvExport(false);
      setAlertEnabled(false);
    } else if (nextTier === 'custom') {
      setInputSources((prev) => (prev.length > 0 ? prev : ['upload', 'camera']));
      setShowConfidence(true);
      setShowLatency(true);
      setShowHistory(false);
      setAllowCsvExport(false);
    } else {
      setInputSources(['upload', 'camera', 'video']);
      setShowConfidence(true);
      setShowLatency(true);
      setShowHistory(true);
      setAllowCsvExport(true);
      setAlertEnabled(true);
    }
  };

  const toggleInputSource = (source: AppInputSource) => {
    setInputSources((prev) => {
      if (prev.includes(source)) {
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s !== source);
      }
      return [...prev, source];
    });
  };

  const stopMediaStreams = useCallback(() => {
    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((tr) => tr.stop());
      cameraStreamRef.current = null;
    }
    if (videoObjectUrlRef.current) {
      URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = null;
    }
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
      liveVideoRef.current.removeAttribute('src');
      liveVideoRef.current.load();
    }
    setCameraActive(false);
    setVideoPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopMediaStreams();
      if (loadedTfModelRef.current) {
        loadedTfModelRef.current.model.dispose();
        loadedTfModelRef.current = null;
      }
    };
  }, [stopMediaStreams]);

  const ensureLoadedTfModel = useCallback(async (modelId: string): Promise<tf.LayersModel> => {
    if (loadedTfModelRef.current && loadedTfModelRef.current.modelId === modelId) {
      return loadedTfModelRef.current.model;
    }
    if (loadedTfModelRef.current) {
      loadedTfModelRef.current.model.dispose();
      loadedTfModelRef.current = null;
    }
    const loaded = await loadTfModelFromIndexedDb(modelId);
    if (!loaded) {
      throw new Error(t.appBuilder.weightsNotLocal);
    }
    loadedTfModelRef.current = { modelId, model: loaded.model };
    return loaded.model;
  }, [t.appBuilder.weightsNotLocal]);

  const drawAndPredictFrame = useCallback(
    async (
      sourceEl: HTMLImageElement | HTMLVideoElement,
      width: number,
      height: number,
      sourceType: AppInputSource
    ) => {
      if (!selectedModel || busyInferRef.current) return;
      const canvas = stageCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      busyInferRef.current = true;
      setInferenceError(null);

      try {
        const targetW = Math.max(1, width);
        const targetH = Math.max(1, height);
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.drawImage(sourceEl, 0, 0, targetW, targetH);

        const frameBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
        );
        if (!frameBlob) {
          throw new Error('Failed to capture canvas frame for inference.');
        }

        const tfModel = await ensureLoadedTfModel(selectedModel.id);
        const pred = await predictImageWithLocalModel({
          model: tfModel,
          taskType: selectedModel.taskType,
          classes: selectedModel.classes,
          inputSize: selectedModel.inputSize,
          imageBlob: frameBlob,
          confidenceThreshold,
          iouThreshold,
        });

        // Re-draw clean frame + overlay bounding boxes if detection
        ctx.drawImage(sourceEl, 0, 0, targetW, targetH);
        const accent = /^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : '#DC2626';

        if (pred.taskType === 'object_detection') {
          for (const box of pred.detections) {
            const bx = box.x * targetW;
            const by = box.y * targetH;
            const bw = box.width * targetW;
            const bh = box.height * targetH;

            ctx.strokeStyle = accent;
            ctx.lineWidth = Math.max(2, Math.round(targetW / 240));
            ctx.strokeRect(bx, by, bw, bh);

            const labelText = showConfidence
              ? `${box.className} ${(box.confidence * 100).toFixed(0)}%`
              : box.className;
            ctx.font = '600 13px system-ui, sans-serif';
            const labelW = Math.max(68, ctx.measureText(labelText).width + 12);
            const labelY = Math.max(0, by - 22);
            ctx.fillStyle = accent;
            ctx.fillRect(bx, labelY, labelW, 22);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(labelText, bx + 6, labelY + 15);
          }
        }

        let topLabel = 'None';
        let topConf = 0;
        let firedAlert = false;

        if (pred.taskType === 'image_classification') {
          const top = pred.classifications[0];
          if (top) {
            topLabel = top.className;
            topConf = top.confidence;
          }
          firedAlert =
            alertEnabled &&
            Boolean(alertTargetClass) &&
            pred.classifications.some(
              (c) =>
                c.className === alertTargetClass &&
                c.confidence >= alertMinConfidence &&
                c.className === topLabel
            );
        } else {
          const top = pred.detections[0];
          if (top) {
            topLabel = top.className;
            topConf = top.confidence;
          }
          firedAlert =
            alertEnabled &&
            Boolean(alertTargetClass) &&
            pred.detections.some(
              (d) => d.className === alertTargetClass && d.confidence >= alertMinConfidence
            );
        }

        setLastPrediction(pred);
        setAlertTriggered(firedAlert);

        if (showHistory) {
          const row: InspectionHistoryRow = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toLocaleTimeString(),
            source: sourceType,
            topLabel,
            confidence: topConf,
            latencyMs: pred.latencyMs,
            alertTriggered: firedAlert,
          };
          setHistoryRows((prev) => [row, ...prev].slice(0, 40));
        }
      } catch (err) {
        setInferenceError(err instanceof Error ? err.message : 'Inference failed.');
      } finally {
        busyInferRef.current = false;
      }
    },
    [
      selectedModel,
      ensureLoadedTfModel,
      confidenceThreshold,
      iouThreshold,
      themeColor,
      showConfidence,
      alertEnabled,
      alertTargetClass,
      alertMinConfidence,
      showHistory,
    ]
  );

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    stopMediaStreams();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      void drawAndPredictFrame(img, img.naturalWidth, img.naturalHeight, 'upload');
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setInferenceError('Failed to decode uploaded image.');
    };
    img.src = url;
  };

  const handleToggleCamera = async () => {
    if (cameraActive) {
      stopMediaStreams();
      return;
    }
    stopMediaStreams();
    setInferenceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setCameraActive(true);
      scanIntervalRef.current = window.setInterval(() => {
        const v = liveVideoRef.current;
        if (v && v.readyState >= 2 && !v.paused) {
          void drawAndPredictFrame(v, v.videoWidth || 640, v.videoHeight || 480, 'camera');
        }
      }, 600);
    } catch (err) {
      setInferenceError(err instanceof Error ? err.message : 'Camera permission denied.');
      stopMediaStreams();
    }
  };

  const handleLoadVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    stopMediaStreams();
    setInferenceError(null);

    const url = URL.createObjectURL(file);
    videoObjectUrlRef.current = url;
    const v = liveVideoRef.current;
    if (!v) return;

    v.src = url;
    v.onloadeddata = () => {
      void v.play();
      setVideoPlaying(true);
      scanIntervalRef.current = window.setInterval(() => {
        if (!v.paused && !v.ended && v.readyState >= 2) {
          void drawAndPredictFrame(v, v.videoWidth || 640, v.videoHeight || 480, 'video');
        } else if (v.ended) {
          stopMediaStreams();
        }
      }, 650);
    };
  };

  const handleExportHistoryCsv = () => {
    if (historyRows.length === 0) return;
    const header = ['Timestamp', 'Source', 'TopPrediction', 'Confidence', 'LatencyMs', 'Alert'].join(
      ','
    );
    const lines = historyRows.map((r) =>
      [
        escapeCsvCell(r.timestamp),
        escapeCsvCell(r.source),
        escapeCsvCell(r.topLabel),
        escapeCsvCell(`${(r.confidence * 100).toFixed(1)}%`),
        escapeCsvCell(r.latencyMs),
        escapeCsvCell(r.alertTriggered ? 'YES' : 'NO'),
      ].join(',')
    );
    triggerTextDownload(`${slugifyName(appName)}-inspection-log.csv`, [header, ...lines].join('\n'), 'text/csv');
  };

  const handleSaveApp = async () => {
    if (!selectedModel) return;
    setSaving(true);
    setStatusNotice(null);
    setErrorNotice(null);

    const effectiveRuntime: AppRuntimeTarget =
      !selectedModel.onDeviceCompatible && runtimeTarget === 'on_device_pwa'
        ? 'hybrid_cloud'
        : runtimeTarget;

    try {
      if (activeSavedApp) {
        await updateGeneratedApp({
          appId: activeSavedApp.id,
          ownerUid: project.ownerUid,
          projectId: project.id,
          modelId: selectedModel.id,
          modelName: selectedModel.name,
          name: appName,
          shortName,
          description,
          tier,
          themeColor,
          backgroundColor,
          runtimeTarget: effectiveRuntime,
          inputSources,
          confidenceThreshold,
          iouThreshold,
          showConfidence,
          showLatency,
          showHistory,
          allowCsvExport,
          customHeaderTitle,
          alertEnabled,
          alertTargetClass,
          alertMinConfidence,
          customIconDataUrl,
          status: 'ready',
          nextVersion: activeSavedApp.version + 1,
        });
      } else {
        const created = await createGeneratedApp({
          ownerUid: project.ownerUid,
          projectId: project.id,
          modelId: selectedModel.id,
          modelName: selectedModel.name,
          taskType: selectedModel.taskType,
          name: appName,
          shortName,
          description,
          tier,
          themeColor,
          backgroundColor,
          runtimeTarget: effectiveRuntime,
          inputSources,
          confidenceThreshold,
          iouThreshold,
          showConfidence,
          showLatency,
          showHistory,
          allowCsvExport,
          customHeaderTitle,
          alertEnabled,
          alertTargetClass,
          alertMinConfidence,
          customIconDataUrl,
          currentAppCount: generatedApps.length,
          projectStatus: project.status,
        });
        setSelectedAppId(created.id);
      }
      setStatusNotice(t.appBuilder.savedNotice);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to save app.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadCustomIcon = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorNotice(null);
    try {
      const dataUrl = await resizeIconFileToDataUrl(file);
      setCustomIconDataUrl(dataUrl);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to load custom app icon.');
    }
  };

  const handleDeleteApp = async () => {
    if (!activeSavedApp) return;
    setDeleting(true);
    setErrorNotice(null);
    try {
      const remaining = Math.max(0, generatedApps.length - 1);
      await deleteGeneratedApp({
        appId: activeSavedApp.id,
        projectId: project.id,
        ownerUid: project.ownerUid,
        appName: activeSavedApp.name,
        remainingAppCount: remaining,
        projectStatus: project.status === 'deployed' && remaining === 0 ? 'trained' : project.status,
      });
      setSelectedAppId(null);
      resetToNewAppDraft();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to delete app.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Build effective GeneratedApp object representing current draft / saved configuration
  const draftAppSpec: GeneratedApp = useMemo(() => {
    const cleanShort = (shortName.trim() || appName.trim() || 'MKVision').slice(0, 12);
    const cleanHex = /^#[0-9a-fA-F]{6}$/.test(themeColor.trim())
      ? themeColor.trim().toUpperCase()
      : '#DC2626';
    return {
      id: activeSavedApp?.id || 'draft_preview',
      projectId: project.id,
      modelId: selectedModel?.id || '',
      modelName: selectedModel?.name || 'Model',
      ownerUid: project.ownerUid,
      taskType: selectedModel?.taskType || project.taskType,
      name: appName.trim() || `${project.name} App`,
      shortName: cleanShort,
      description: description.trim(),
      tier,
      themeColor: cleanHex,
      backgroundColor,
      runtimeTarget,
      inputSources: inputSources.length > 0 ? inputSources : ['upload'],
      confidenceThreshold,
      iouThreshold,
      showConfidence,
      showLatency,
      showHistory,
      allowCsvExport,
      customHeaderTitle: customHeaderTitle.trim(),
      alertEnabled,
      alertTargetClass,
      alertMinConfidence,
      customIconDataUrl: isValidCustomIconDataUrl(customIconDataUrl) ? customIconDataUrl : '',
      status: activeSavedApp?.status || 'ready',
      version: activeSavedApp?.version || 1,
      createdAt: activeSavedApp?.createdAt || null,
      updatedAt: activeSavedApp?.updatedAt || null,
    };
  }, [
    activeSavedApp,
    project.id,
    project.ownerUid,
    project.name,
    project.taskType,
    selectedModel,
    appName,
    shortName,
    description,
    tier,
    themeColor,
    backgroundColor,
    runtimeTarget,
    inputSources,
    confidenceThreshold,
    iouThreshold,
    showConfidence,
    showLatency,
    showHistory,
    allowCsvExport,
    customHeaderTitle,
    alertEnabled,
    alertTargetClass,
    alertMinConfidence,
    customIconDataUrl,
  ]);

  const handleDownloadStandaloneHtml = async () => {
    if (!selectedModel) return;
    setErrorNotice(null);
    try {
      const artifact = await getStoredModelRecord(selectedModel.id);
      const { html, filename } = buildStandaloneHtmlApp({
        app: draftAppSpec,
        model: selectedModel,
        artifact,
        locale,
      });
      triggerTextDownload(filename, html, 'text/html;charset=utf-8');
      if (activeSavedApp) {
        await logActivity({
          ownerUid: project.ownerUid,
          projectId: project.id,
          action: 'app_exported',
          targetType: 'app',
          targetName: draftAppSpec.name,
        });
      }
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Standalone export failed.');
    }
  };

  if (trainedModels.length === 0 || !selectedModel) {
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-10 bg-white dark:bg-zinc-900 text-center space-y-4">
        <Smartphone className="w-8 h-8 text-red-600 dark:text-red-500 mx-auto" />
        <div className="space-y-1 max-w-md mx-auto">
          <h2 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.appBuilder.emptyTitle}
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
            {t.appBuilder.emptyDesc}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenTraining}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
        >
          <span>{t.appBuilder.goTrainingBtn}</span>
        </button>
      </div>
    );
  }

  const hasLocalWeights = storedKeys.has(selectedModel.id);
  const validManifestSpec =
    draftAppSpec.shortName.length >= 1 &&
    draftAppSpec.shortName.length <= 12 &&
    /^#[0-9a-fA-F]{6}$/.test(draftAppSpec.themeColor);
  const offlineRuntimeReady =
    selectedModel.onDeviceCompatible && draftAppSpec.runtimeTarget === 'on_device_pwa';

  const runnerIsDark = backgroundColor === 'dark';
  const viewportWidthClass = standaloneFullscreen
    ? 'w-full max-w-6xl mx-auto'
    : viewport === 'mobile'
    ? 'w-full max-w-[390px] mx-auto'
    : viewport === 'tablet'
    ? 'w-full max-w-[740px] mx-auto'
    : 'w-full';

  const runnerSurface = (
    <div
      className={`border rounded-xl overflow-hidden transition-all ${viewportWidthClass} ${
        runnerIsDark
          ? 'bg-zinc-950 border-zinc-800 text-zinc-100'
          : 'bg-white border-zinc-200 text-zinc-900'
      }`}
    >
      {/* Generated App Header */}
      <div
        className={`px-4 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 ${
          runnerIsDark ? 'border-zinc-800 bg-zinc-900/70' : 'border-zinc-200 bg-zinc-50'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {isValidCustomIconDataUrl(draftAppSpec.customIconDataUrl) ? (
            <img
              src={draftAppSpec.customIconDataUrl}
              alt={draftAppSpec.shortName}
              className="w-8 h-8 rounded-lg object-cover shrink-0 border border-white/10"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-display font-bold text-xs shrink-0"
              style={{ backgroundColor: draftAppSpec.themeColor }}
            >
              {draftAppSpec.shortName.slice(0, 2).toUpperCase() || 'MK'}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-display font-semibold truncate">
              {draftAppSpec.customHeaderTitle || draftAppSpec.name}
            </div>
            <div
              className={`text-[11px] truncate ${
                runnerIsDark ? 'text-zinc-400' : 'text-zinc-500'
              }`}
            >
              {draftAppSpec.description || `${selectedModel.name} · ${t.tasks[selectedModel.taskType]}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[11px] font-mono ${
              runnerIsDark ? 'text-zinc-400' : 'text-zinc-500'
            }`}
          >
            v{draftAppSpec.version} · {draftAppSpec.tier.toUpperCase()}
          </span>
          {standaloneFullscreen && (
            <button
              type="button"
              onClick={() => setStandaloneFullscreen(false)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-500/40 text-xs font-medium hover:opacity-80 whitespace-nowrap shrink-0"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>{t.appBuilder.exitStandaloneBtn}</span>
            </button>
          )}
        </div>
      </div>

      {/* Alert Banner */}
      {alertTriggered && (
        <div className="px-4 py-2.5 bg-red-600 text-white text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {t.appBuilder.alertTriggeredLabel}: {alertTargetClass} (≥{' '}
              {Math.round(alertMinConfidence * 100)}%)
            </span>
          </div>
          <span className="font-mono tabular-nums">
            {new Date().toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* Main Runner Body */}
      <div
        className={`p-4 grid gap-4 ${
          viewport === 'mobile' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-12'
        }`}
      >
        {/* Left Stage & Controls */}
        <div className={viewport === 'mobile' ? 'space-y-3' : 'lg:col-span-7 space-y-3'}>
          <div className="flex flex-wrap items-center gap-2">
            {inputSources.includes('upload') && (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white whitespace-nowrap shrink-0"
                style={{ backgroundColor: draftAppSpec.themeColor }}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t.appBuilder.uploadTestBtn}</span>
              </button>
            )}
            {inputSources.includes('camera') && (
              <button
                type="button"
                onClick={() => void handleToggleCamera()}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 ${
                  cameraActive
                    ? 'border-red-600 text-red-500'
                    : runnerIsDark
                    ? 'border-zinc-700 text-zinc-200 hover:bg-zinc-900'
                    : 'border-zinc-300 text-zinc-800 hover:bg-zinc-100'
                }`}
              >
                {cameraActive ? <Square className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                <span>
                  {cameraActive ? t.appBuilder.cameraStopBtn : t.appBuilder.cameraStartBtn}
                </span>
              </button>
            )}
            {inputSources.includes('video') && (
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 ${
                  runnerIsDark
                    ? 'border-zinc-700 text-zinc-200 hover:bg-zinc-900'
                    : 'border-zinc-300 text-zinc-800 hover:bg-zinc-100'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>{t.appBuilder.videoScanBtn}</span>
              </button>
            )}
            {(cameraActive || videoPlaying) && (
              <button
                type="button"
                onClick={stopMediaStreams}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:underline whitespace-nowrap shrink-0"
              >
                <Square className="w-3 h-3" />
                <span>{t.appBuilder.cameraStopBtn}</span>
              </button>
            )}
          </div>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleUploadImage}
            className="hidden"
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={handleLoadVideo}
            className="hidden"
          />

          <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-black border border-zinc-800 flex items-center justify-center">
            <video
              ref={liveVideoRef}
              playsInline
              muted
              className="hidden"
            />
            <canvas
              ref={stageCanvasRef}
              className="max-w-full max-h-full object-contain block"
            />
            {!lastPrediction && !cameraActive && !videoPlaying && (
              <p className="absolute inset-x-6 text-center text-xs text-zinc-400 pointer-events-none">
                {t.appBuilder.noPredictionYet}
              </p>
            )}
          </div>

          {inferenceError && (
            <div className="p-2.5 rounded-lg border border-red-800 bg-red-950/60 text-xs text-red-200">
              {inferenceError}
            </div>
          )}
        </div>

        {/* Right Output + History */}
        <div className={viewport === 'mobile' ? 'space-y-4' : 'lg:col-span-5 space-y-4'}>
          <div
            className={`border rounded-lg p-3.5 space-y-3 ${
              runnerIsDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-display font-semibold">
                {t.appBuilder.predictionOutputTitle}
              </h4>
              {showLatency && lastPrediction && (
                <span className="text-[11px] font-mono tabular-nums text-emerald-500">
                  {lastPrediction.latencyMs.toFixed(1)} ms
                </span>
              )}
            </div>

            {!lastPrediction ? (
              <p className={`text-xs ${runnerIsDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {t.appBuilder.noPredictionYet}
              </p>
            ) : lastPrediction.taskType === 'image_classification' ? (
              <div className="space-y-2.5">
                {lastPrediction.classifications.map((c) => (
                  <div key={c.className} className="space-y-1">
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-medium truncate">{c.className}</span>
                      {showConfidence && (
                        <span className="font-mono font-semibold">
                          {(c.confidence * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {showConfidence && (
                      <div
                        className={`h-2 rounded-full overflow-hidden ${
                          runnerIsDark ? 'bg-zinc-800' : 'bg-zinc-200'
                        }`}
                      >
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${Math.round(c.confidence * 100)}%`,
                            backgroundColor: draftAppSpec.themeColor,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : lastPrediction.detections.length === 0 ? (
              <p className={`text-xs ${runnerIsDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                No boxes above {(confidenceThreshold * 100).toFixed(0)}% confidence.
              </p>
            ) : (
              <div className="space-y-1.5">
                {lastPrediction.detections.map((d, idx) => (
                  <div
                    key={`${d.className}-${idx}`}
                    className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded border tabular-nums ${
                      runnerIsDark ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'
                    }`}
                  >
                    <span className="font-medium">{d.className}</span>
                    {showConfidence && (
                      <span className="font-mono font-semibold">
                        {(d.confidence * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {showHistory && (
            <div
              className={`border rounded-lg p-3.5 space-y-2.5 ${
                runnerIsDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-display font-semibold">
                  {t.appBuilder.historyLogTitle} ({historyRows.length})
                </h4>
                <div className="flex items-center gap-1.5">
                  {allowCsvExport && historyRows.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExportHistoryCsv}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-zinc-500/40 hover:opacity-80 whitespace-nowrap shrink-0"
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      <span>{t.appBuilder.exportCsvBtn}</span>
                    </button>
                  )}
                  {historyRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistoryRows([])}
                      className="px-2 py-1 text-[11px] opacity-75 hover:opacity-100 whitespace-nowrap shrink-0"
                    >
                      {t.appBuilder.clearHistoryBtn}
                    </button>
                  )}
                </div>
              </div>

              {historyRows.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead>
                      <tr className="border-b border-zinc-500/20 text-start">
                        <th className="py-1 font-medium text-start">Time</th>
                        <th className="py-1 font-medium text-start">Result</th>
                        <th className="py-1 font-medium text-end">Conf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row) => (
                        <tr key={row.id} className="border-b border-zinc-500/10">
                          <td className="py-1 font-mono opacity-80">{row.timestamp}</td>
                          <td className="py-1 font-medium">
                            {row.alertTriggered ? `! ${row.topLabel}` : row.topLabel}
                          </td>
                          <td className="py-1 font-mono text-end">
                            {(row.confidence * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header & Saved Apps Switcher */}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {t.appBuilder.heading}
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
              {t.appBuilder.subheading}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetToNewAppDraft}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.appBuilder.newAppBtn}</span>
            </button>
            <button
              type="button"
              disabled={saving || appName.trim().length < 2}
              onClick={() => void handleSaveApp()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {saving
                  ? t.appBuilder.savingBtn
                  : activeSavedApp
                  ? t.appBuilder.updateAppBtn
                  : t.appBuilder.saveAppBtn}
              </span>
            </button>
          </div>
        </div>

        {/* Saved Apps Selector */}
        {generatedApps.length > 0 && (
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                {t.appBuilder.savedAppsLabel}:
              </span>
              {generatedApps.map((app) => {
                const isSelected = activeSavedApp?.id === app.id;
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => loadAppIntoForm(app)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                      isSelected
                        ? 'border-red-600 bg-red-50/60 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {app.name} · v{app.version}
                  </button>
                );
              })}
            </div>

            {activeSavedApp && (
              <div>
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.appBuilder.deleteAppBtn}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDeleteApp()}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 whitespace-nowrap shrink-0"
                    >
                      {t.appBuilder.confirmDeleteBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 whitespace-nowrap shrink-0"
                    >
                      {t.projectModal.cancel}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {statusNotice && (
          <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            {statusNotice}
          </div>
        )}
        {errorNotice && (
          <div className="text-xs text-red-600 dark:text-red-400 font-medium">
            {errorNotice}
          </div>
        )}
      </div>

      {/* Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 01. App Identity, Tier & Branding */}
        <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-4">
          <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.appBuilder.configIdentityTitle}
          </h3>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.appBuilder.tierLabel}
            </label>
            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  {
                    id: 'basic' as AppTier,
                    title: t.appBuilder.tierBasic,
                    desc: t.appBuilder.tierBasicDesc,
                  },
                  {
                    id: 'custom' as AppTier,
                    title: t.appBuilder.tierCustom,
                    desc: t.appBuilder.tierCustomDesc,
                  },
                  {
                    id: 'professional' as AppTier,
                    title: t.appBuilder.tierProfessional,
                    desc: t.appBuilder.tierProfessionalDesc,
                  },
                ]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyTierPreset(item.id)}
                  className={`text-start p-3 rounded-lg border transition-colors ${
                    tier === item.id
                      ? 'border-red-600 bg-red-50/40 dark:bg-red-950/20'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-950'
                  }`}
                >
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {item.title}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {item.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t.appBuilder.appNameLabel}
              </label>
              <input
                type="text"
                maxLength={80}
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="flex items-center justify-between text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                <span>{t.appBuilder.shortNameLabel}</span>
                <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                  {shortName.length}/12
                </span>
              </label>
              <input
                type="text"
                maxLength={12}
                value={shortName}
                onChange={(e) => setShortName(e.target.value.slice(0, 12))}
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t.appBuilder.surfaceModeLabel}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['dark', 'light'] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setBackgroundColor(mode)}
                    className={`py-2 text-xs font-medium rounded-lg border ${
                      backgroundColor === mode
                        ? 'border-red-600 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                        : 'border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    {mode === 'dark' ? t.appBuilder.surfaceDark : t.appBuilder.surfaceLight}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t.appBuilder.customHeaderLabel}
            </label>
            <input
              type="text"
              maxLength={80}
              value={customHeaderTitle}
              onChange={(e) => setCustomHeaderTitle(e.target.value)}
              placeholder={appName}
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t.appBuilder.appDescLabel}
            </label>
            <textarea
              rows={2}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.appBuilder.themeColorLabel}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : '#DC2626'}
                onChange={(e) => setThemeColor(e.target.value.toUpperCase())}
                className="w-9 h-8 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent cursor-pointer"
              />
              <div className="flex items-center gap-1.5">
                {ACCENT_PRESETS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setThemeColor(hex)}
                    aria-label={hex}
                    className={`w-6 h-6 rounded border ${
                      themeColor.toUpperCase() === hex
                        ? 'ring-2 ring-offset-1 ring-zinc-900 dark:ring-zinc-100'
                        : 'border-zinc-300 dark:border-zinc-700'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
              <span className="ms-auto font-mono text-[11px] text-zinc-500">
                {themeColor.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Custom App Icon Upload */}
          <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.appBuilder.customIconLabel}
            </label>
            <div className="flex items-center gap-3">
              {isValidCustomIconDataUrl(customIconDataUrl) ? (
                <img
                  src={customIconDataUrl}
                  alt="App icon preview"
                  className="w-11 h-11 rounded-lg object-cover border border-zinc-300 dark:border-zinc-700 shrink-0"
                />
              ) : (
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-display font-bold text-sm shrink-0"
                  style={{ backgroundColor: draftAppSpec.themeColor }}
                >
                  {draftAppSpec.shortName.slice(0, 2).toUpperCase() || 'MK'}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={iconInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => void handleUploadCustomIcon(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => iconInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t.appBuilder.uploadIconBtn}</span>
                </button>
                {customIconDataUrl && (
                  <button
                    type="button"
                    onClick={() => setCustomIconDataUrl('')}
                    className="px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 hover:underline"
                  >
                    {t.appBuilder.resetIconBtn}
                  </button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {t.appBuilder.customIconHint}
            </p>
          </div>
        </section>

        {/* 02. Model Binding & Runtime Compatibility */}
        <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-4">
          <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.appBuilder.modelRuntimeTitle}
          </h3>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              {t.appBuilder.targetModelLabel}
            </label>
            <select
              value={selectedModel.id}
              onChange={(e) => {
                setSelectedModelId(e.target.value);
                setLastPrediction(null);
                setAlertTriggered(false);
              }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              {trainedModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.architecture}) {m.isActive ? '★' : ''}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
              hasLocalWeights
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/15 text-emerald-800 dark:text-emerald-300'
                : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/15 text-amber-800 dark:text-amber-300'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {hasLocalWeights ? t.appBuilder.weightsVerified : t.appBuilder.weightsNotLocal}
            </span>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.appBuilder.runtimeTargetLabel}
            </label>
            <div className="space-y-2">
              <button
                type="button"
                disabled={!selectedModel.onDeviceCompatible}
                onClick={() => setRuntimeTarget('on_device_pwa')}
                className={`w-full text-start p-3 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  runtimeTarget === 'on_device_pwa'
                    ? 'border-red-600 bg-red-50/40 dark:bg-red-950/20'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {t.appBuilder.runtimeOnDevice}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRuntimeTarget('hybrid_cloud')}
                className={`w-full text-start p-3 rounded-lg border transition-colors ${
                  runtimeTarget === 'hybrid_cloud'
                    ? 'border-red-600 bg-red-50/40 dark:bg-red-950/20'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {t.appBuilder.runtimeHybridCloud}
                </div>
              </button>
            </div>

            {!selectedModel.onDeviceCompatible && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                {t.appBuilder.onDeviceBlockedHint}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs space-y-1.5 tabular-nums text-zinc-600 dark:text-zinc-400">
            <div className="flex justify-between">
              <span>{t.trainingStudio.architectureLabel}</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {selectedModel.architecture}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t.trainingStudio.inputSizeLabel}</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {selectedModel.inputSize}×{selectedModel.inputSize}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t.datasetStudio.classesTitle}</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {selectedModel.classes.length}
              </span>
            </div>
          </div>
        </section>

        {/* 03. Input Sources, Telemetry & Alert Gates */}
        <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-4">
          <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.appBuilder.controlsAlertTitle}
          </h3>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t.appBuilder.inputSourcesLabel}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'upload' as AppInputSource, label: t.appBuilder.sourceUpload },
                  { id: 'camera' as AppInputSource, label: t.appBuilder.sourceCamera },
                  { id: 'video' as AppInputSource, label: t.appBuilder.sourceVideo },
                ]
              ).map((src) => {
                const active = inputSources.includes(src.id);
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => toggleInputSource(src.id)}
                    className={`px-2 py-2 rounded-lg border text-[11px] font-medium text-center transition-colors ${
                      active
                        ? 'border-red-600 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    {src.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 tabular-nums">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-700 dark:text-zinc-300">
                {t.appBuilder.confThresholdLabel}
              </span>
              <span className="font-mono font-semibold">
                {(confidenceThreshold * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
              className="w-full accent-red-600"
            />
          </div>

          {selectedModel.taskType === 'object_detection' && (
            <div className="space-y-2 tabular-nums">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-700 dark:text-zinc-300">
                  {t.appBuilder.iouThresholdLabel}
                </span>
                <span className="font-mono font-semibold">
                  {(iouThreshold * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.95}
                step={0.05}
                value={iouThreshold}
                onChange={(e) => setIouThreshold(Number(e.target.value))}
                className="w-full accent-red-600"
              />
            </div>
          )}

          <div className="space-y-2 pt-1 text-xs">
            {[
              {
                checked: showConfidence,
                onChange: setShowConfidence,
                label: t.appBuilder.showConfidenceLabel,
              },
              {
                checked: showLatency,
                onChange: setShowLatency,
                label: t.appBuilder.showLatencyLabel,
              },
              {
                checked: showHistory,
                onChange: setShowHistory,
                label: t.appBuilder.showHistoryLabel,
              },
              {
                checked: allowCsvExport,
                onChange: setAllowCsvExport,
                label: t.appBuilder.allowCsvExportLabel,
              },
            ].map((toggle) => (
              <label key={toggle.label} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={toggle.checked}
                  onChange={(e) => toggle.onChange(e.target.checked)}
                  className="accent-red-600"
                />
                <span className="text-zinc-700 dark:text-zinc-300">{toggle.label}</span>
              </label>
            ))}
          </div>

          {/* Inspection Alert Gate */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2.5 text-xs">
            <label className="flex items-center gap-2 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={alertEnabled}
                onChange={(e) => setAlertEnabled(e.target.checked)}
                className="accent-red-600"
              />
              <span>{t.appBuilder.alertRuleLabel}</span>
            </label>

            {alertEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">
                    {t.appBuilder.alertClassLabel}
                  </label>
                  <select
                    value={alertTargetClass}
                    onChange={(e) => setAlertTargetClass(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  >
                    {selectedModel.classes.map((cls) => (
                      <option key={cls} value={cls}>
                        {cls}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1 tabular-nums">
                    {t.appBuilder.alertMinConfLabel} ({Math.round(alertMinConfidence * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={0.99}
                    step={0.05}
                    value={alertMinConfidence}
                    onChange={(e) => setAlertMinConfidence(Number(e.target.value))}
                    className="w-full accent-red-600 mt-1.5"
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Live Interactive Runner (Responsive Viewport + Full-Screen Standalone Mode) */}
      <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-zinc-50 dark:bg-zinc-900/50 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
            {t.appBuilder.previewTitle}
          </h3>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'desktop' as const, label: t.appBuilder.viewportDesktop, icon: Monitor },
                { id: 'tablet' as const, label: t.appBuilder.viewportTablet, icon: Tablet },
                { id: 'mobile' as const, label: t.appBuilder.viewportMobile, icon: Smartphone },
              ]
            ).map((vp) => {
              const Icon = vp.icon;
              const active = viewport === vp.id;
              return (
                <button
                  key={vp.id}
                  type="button"
                  onClick={() => setViewport(vp.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-red-600 bg-white dark:bg-zinc-900 text-red-600 dark:text-red-500'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{vp.label}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setStandaloneFullscreen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 whitespace-nowrap shrink-0"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>{t.appBuilder.launchStandaloneBtn}</span>
            </button>
          </div>
        </div>

        {standaloneFullscreen ? (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto flex items-start justify-center">
            {runnerSurface}
          </div>
        ) : (
          runnerSurface
        )}
      </section>

      {/* 04. PWA Readiness & Standalone Package Export */}
      <section className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 bg-white dark:bg-zinc-900 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {t.appBuilder.readinessTitle}
            </h3>
            <div className="space-y-2 text-xs">
              {[
                { ok: hasLocalWeights, label: t.appBuilder.checkWeights },
                { ok: validManifestSpec, label: t.appBuilder.checkManifest },
                { ok: offlineRuntimeReady, label: t.appBuilder.checkOfflineRuntime },
                { ok: true, label: t.appBuilder.checkServiceWorker },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                >
                  <span
                    className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                      item.ok
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-zinc-800 dark:text-zinc-200">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-display font-semibold text-zinc-900 dark:text-zinc-100">
              {t.appBuilder.pwaExportTitle}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => void handleDownloadStandaloneHtml()}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.appBuilder.downloadStandaloneBtn}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerTextDownload(
                    'manifest.webmanifest',
                    buildPwaManifestJson(draftAppSpec),
                    'application/manifest+json'
                  )
                }
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <FileCode2 className="w-3.5 h-3.5 text-red-600 dark:text-red-500" />
                <span>{t.appBuilder.downloadManifestBtn}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerTextDownload(
                    'sw.js',
                    buildServiceWorkerJs(draftAppSpec),
                    'application/javascript'
                  )
                }
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <FileCode2 className="w-3.5 h-3.5 text-red-600 dark:text-red-500" />
                <span>{t.appBuilder.downloadSwBtn}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerTextDownload(
                    'app-icon.svg',
                    buildAppIconSvg(draftAppSpec),
                    'image/svg+xml'
                  )
                }
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-red-600 dark:text-red-500" />
                <span>{t.appBuilder.downloadIconBtn}</span>
              </button>

              {isValidCustomIconDataUrl(customIconDataUrl) && (
                <button
                  type="button"
                  onClick={() => triggerDataUrlDownload('app-icon.png', customIconDataUrl)}
                  className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5 text-red-600 dark:text-red-500" />
                  <span>{t.appBuilder.downloadPngIconBtn}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  triggerTextDownload(
                    'README.md',
                    buildPwaReadme(draftAppSpec, selectedModel),
                    'text/markdown'
                  )
                }
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-zinc-500" />
                <span>{t.appBuilder.downloadReadmeBtn}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  triggerTextDownload(
                    `${slugifyName(draftAppSpec.name)}.mkapp.json`,
                    JSON.stringify({ app: draftAppSpec, model: selectedModel }, null, 2),
                    'application/json'
                  )
                }
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-zinc-500" />
                <span>{t.appBuilder.downloadConfigBtn}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
