import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { DEFAULT_AUGMENTATION_CONFIG } from '../lib/datasetUtils';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import { deleteDatasetMediaBlobs, deleteMediaBlob } from '../lib/localMediaStore';
import { deleteStoredModelRecord } from '../lib/localModelStore';
import type {
  ActivityAction,
  ActivityLog,
  AppInputSource,
  AppRuntimeTarget,
  AppTier,
  AugmentationConfig,
  BoundingBox,
  Dataset,
  DatasetItem,
  DatasetSourceType,
  DatasetSplit,
  EpochMetricPoint,
  EvaluationReport,
  EvaluationSplitTarget,
  GeneratedApp,
  GeneratedAppStatus,
  Locale,
  PerClassMetric,
  Project,
  ProjectStatus,
  StorageProvider,
  ThemeMode,
  TrainedModel,
  TrainingBackendEngine,
  TrainingHyperparameters,
  TrainingMode,
  TrainingRun,
  TrainingStatus,
  UserProfile,
  V1TaskType,
  Workspace,
} from '../types/domain';

function makeId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${raw.slice(0, 20)}`;
}

function toTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === 'function') return fn.call(value);
  }
  return 0;
}

export async function ensureUserProfileAndWorkspace(
  user: User,
  defaultLocale: Locale,
  defaultTheme: ThemeMode
): Promise<{ profile: UserProfile; personalWorkspaceId: string }> {
  const userRef = doc(db, 'users', user.uid);
  const personalWorkspaceId = `ws_personal_${user.uid.slice(0, 24)}`;
  const wsRef = doc(db, 'workspaces', personalWorkspaceId);
  const memberRef = doc(db, 'workspaces', personalWorkspaceId, 'members', user.uid);

  let profile: UserProfile;

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      const displayName = (
        user.displayName?.trim() ||
        user.email?.split('@')[0] ||
        'MK Engineer'
      ).slice(0, 120);

      const newProfile: UserProfile = {
        uid: user.uid,
        email: (user.email || 'user@mktech.local').slice(0, 254),
        displayName,
        preferredLocale: defaultLocale,
        preferredTheme: defaultTheme,
        planTier: 'free',
        storageUsedBytes: 0,
        storageQuotaBytes: 5_368_709_120,
        cloudCreditsBalance: 100,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, newProfile);
      profile = newProfile;
    } else {
      profile = snap.data() as UserProfile;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }

  try {
    const wsSnap = await getDoc(wsRef);
    if (!wsSnap.exists()) {
      await setDoc(wsRef, {
        id: personalWorkspaceId,
        name: 'Personal Workspace',
        type: 'personal',
        ownerUid: user.uid,
        storageProvider: 'local',
        cloudRegion: 'local-device',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(memberRef, {
        uid: user.uid,
        workspaceId: personalWorkspaceId,
        role: 'owner',
        addedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `workspaces/${personalWorkspaceId}`
    );
  }

  return { profile, personalWorkspaceId };
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void
): Unsubscribe {
  const ref = doc(db, 'users', uid);
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserProfile) : null);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
    }
  );
}

export function subscribeWorkspaces(
  uid: string,
  onData: (workspaces: Workspace[]) => void
): Unsubscribe {
  const q = query(collection(db, 'workspaces'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as Workspace);
      items.sort((a, b) => toTimestampMs(a.createdAt) - toTimestampMs(b.createdAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'workspaces');
    }
  );
}

export function subscribeProjects(
  uid: string,
  onData: (projects: Project[]) => void
): Unsubscribe {
  const q = query(collection(db, 'projects'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as Project);
      items.sort((a, b) => toTimestampMs(b.updatedAt) - toTimestampMs(a.updatedAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    }
  );
}

export function subscribeActivityLogs(
  uid: string,
  onData: (logs: ActivityLog[]) => void
): Unsubscribe {
  const q = query(collection(db, 'activityLogs'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as ActivityLog);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items.slice(0, 20));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'activityLogs');
    }
  );
}

export async function logActivity(params: {
  ownerUid: string;
  projectId: string;
  action: ActivityAction;
  targetType: 'project' | 'workspace' | 'account' | 'dataset' | 'training_run' | 'model' | 'app';
  targetName: string;
}): Promise<void> {
  const logId = makeId('log');
  try {
    await setDoc(doc(db, 'activityLogs', logId), {
      id: logId,
      ownerUid: params.ownerUid,
      projectId: params.projectId.slice(0, 128),
      action: params.action,
      targetType: params.targetType,
      targetName: params.targetName.trim().slice(0, 120) || 'Item',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `activityLogs/${logId}`);
  }
}

export async function createProject(params: {
  ownerUid: string;
  workspaceId: string;
  name: string;
  description: string;
  taskType: V1TaskType;
  trainingMode: TrainingMode;
  storageLocation: StorageProvider;
  cloudConsentGranted: boolean;
}): Promise<Project> {
  const cleanName = params.name.trim().slice(0, 100);
  if (cleanName.length < 2) {
    throw new Error('Project name must be at least 2 characters.');
  }
  if (params.storageLocation === 'cloud' && !params.cloudConsentGranted) {
    throw new Error('Explicit user consent is required before enabling Cloud Sync.');
  }

  const projectId = makeId('proj');
  const projectData: Project = {
    id: projectId,
    workspaceId: params.workspaceId,
    ownerUid: params.ownerUid,
    name: cleanName,
    description: params.description.trim().slice(0, 500),
    taskType: params.taskType,
    engineVersion: 'v1.0',
    status: 'draft',
    trainingMode: params.trainingMode,
    storageLocation: params.storageLocation,
    cloudConsentGranted: params.cloudConsentGranted,
    datasetCount: 0,
    modelCount: 0,
    appCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'projects', projectId), projectData);
    await logActivity({
      ownerUid: params.ownerUid,
      projectId,
      action: 'project_created',
      targetType: 'project',
      targetName: cleanName,
    });
    return projectData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}`);
  }
}

export async function updateProjectSettings(params: {
  projectId: string;
  ownerUid: string;
  name: string;
  description: string;
  trainingMode: TrainingMode;
  storageLocation: StorageProvider;
  cloudConsentGranted: boolean;
}): Promise<void> {
  const cleanName = params.name.trim().slice(0, 100);
  if (cleanName.length < 2) {
    throw new Error('Project name must be at least 2 characters.');
  }
  if (params.storageLocation === 'cloud' && !params.cloudConsentGranted) {
    throw new Error('Explicit user consent is required before enabling Cloud Sync.');
  }

  try {
    await updateDoc(doc(db, 'projects', params.projectId), {
      name: cleanName,
      description: params.description.trim().slice(0, 500),
      trainingMode: params.trainingMode,
      storageLocation: params.storageLocation,
      cloudConsentGranted: params.cloudConsentGranted,
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'project_updated',
      targetType: 'project',
      targetName: cleanName,
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `projects/${params.projectId}`
    );
  }
}

export async function updateProjectDatasetState(params: {
  projectId: string;
  datasetCount: number;
  status: Extract<ProjectStatus, 'draft' | 'dataset_ready'>;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'projects', params.projectId), {
      datasetCount: Math.max(0, params.datasetCount),
      status: params.status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `projects/${params.projectId}`
    );
  }
}

export async function deleteProject(
  projectId: string,
  ownerUid: string,
  projectName: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'projects', projectId));
    await logActivity({
      ownerUid,
      projectId,
      action: 'project_deleted',
      targetType: 'project',
      targetName: projectName,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}`);
  }
}

export async function createWorkspace(params: {
  ownerUid: string;
  name: string;
  type: 'personal' | 'team';
  storageProvider: StorageProvider;
  cloudRegion: string;
}): Promise<Workspace> {
  const cleanName = params.name.trim().slice(0, 100);
  if (cleanName.length < 2) {
    throw new Error('Workspace name must be at least 2 characters.');
  }
  const workspaceId = makeId('ws');
  const workspace: Workspace = {
    id: workspaceId,
    name: cleanName,
    type: params.type,
    ownerUid: params.ownerUid,
    storageProvider: params.storageProvider,
    cloudRegion: params.cloudRegion.trim().slice(0, 64) || 'local-device',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'workspaces', workspaceId), workspace);
    await setDoc(doc(db, 'workspaces', workspaceId, 'members', params.ownerUid), {
      uid: params.ownerUid,
      workspaceId,
      role: 'owner',
      addedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: '',
      action: 'workspace_created',
      targetType: 'workspace',
      targetName: cleanName,
    });
    return workspace;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `workspaces/${workspaceId}`
    );
  }
}

export async function updateUserPreferences(params: {
  uid: string;
  displayName?: string;
  preferredLocale?: Locale;
  preferredTheme?: ThemeMode;
}): Promise<void> {
  const updates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (params.displayName !== undefined) {
    const clean = params.displayName.trim().slice(0, 120);
    if (clean.length < 1) {
      throw new Error('Display name cannot be empty.');
    }
    updates.displayName = clean;
  }
  if (params.preferredLocale !== undefined) {
    updates.preferredLocale = params.preferredLocale;
  }
  if (params.preferredTheme !== undefined) {
    updates.preferredTheme = params.preferredTheme;
  }

  try {
    await updateDoc(doc(db, 'users', params.uid), updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${params.uid}`);
  }
}

// --- Phase 2: Dataset & Annotation Studio Services ---

export function subscribeProjectDatasets(
  projectId: string,
  ownerUid: string,
  onData: (datasets: Dataset[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'datasets'),
    where('ownerUid', '==', ownerUid),
    where('projectId', '==', projectId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as Dataset);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'datasets');
    }
  );
}

export function subscribeDatasetItems(
  datasetId: string,
  ownerUid: string,
  onData: (items: DatasetItem[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'datasets', datasetId, 'items'),
    where('ownerUid', '==', ownerUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as DatasetItem);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `datasets/${datasetId}/items`);
    }
  );
}

export async function createDataset(params: {
  ownerUid: string;
  projectId: string;
  currentDatasetCount: number;
  name: string;
  description: string;
  classes: string[];
}): Promise<Dataset> {
  const cleanName = params.name.trim().slice(0, 100);
  if (cleanName.length < 2) {
    throw new Error('Dataset name must be at least 2 characters.');
  }

  const cleanClasses = Array.from(
    new Set(
      params.classes
        .map((c) => c.trim().slice(0, 80))
        .filter((c) => c.length >= 1)
    )
  ).slice(0, 50);

  const datasetId = makeId('ds');
  const dataset: Dataset = {
    id: datasetId,
    projectId: params.projectId,
    ownerUid: params.ownerUid,
    name: cleanName,
    description: params.description.trim().slice(0, 500),
    version: 1,
    classes: cleanClasses,
    splitTrainPct: 70,
    splitValPct: 20,
    splitTestPct: 10,
    augmentationConfig: { ...DEFAULT_AUGMENTATION_CONFIG },
    imageCount: 0,
    annotatedCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'datasets', datasetId), dataset);
    await updateDoc(doc(db, 'projects', params.projectId), {
      datasetCount: params.currentDatasetCount + 1,
      status: 'draft',
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'dataset_created',
      targetType: 'dataset',
      targetName: cleanName,
    });
    return dataset;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `datasets/${datasetId}`);
  }
}

export async function updateDatasetClassesAndMeta(params: {
  datasetId: string;
  name: string;
  description: string;
  classes: string[];
  version: number;
}): Promise<void> {
  const cleanName = params.name.trim().slice(0, 100);
  const cleanClasses = Array.from(
    new Set(
      params.classes
        .map((c) => c.trim().slice(0, 80))
        .filter((c) => c.length >= 1)
    )
  ).slice(0, 50);

  try {
    await updateDoc(doc(db, 'datasets', params.datasetId), {
      name: cleanName,
      description: params.description.trim().slice(0, 500),
      classes: cleanClasses,
      version: Math.max(1, Math.min(1000, params.version)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `datasets/${params.datasetId}`);
  }
}

export async function updateDatasetSplits(params: {
  datasetId: string;
  splitTrainPct: number;
  splitValPct: number;
  splitTestPct: number;
}): Promise<void> {
  const sum = params.splitTrainPct + params.splitValPct + params.splitTestPct;
  if (sum !== 100) {
    throw new Error('Train, Validation, and Test split percentages must sum to 100%.');
  }
  try {
    await updateDoc(doc(db, 'datasets', params.datasetId), {
      splitTrainPct: params.splitTrainPct,
      splitValPct: params.splitValPct,
      splitTestPct: params.splitTestPct,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `datasets/${params.datasetId}`);
  }
}

export async function updateDatasetAugmentation(params: {
  datasetId: string;
  augmentationConfig: AugmentationConfig;
}): Promise<void> {
  const safeCfg: AugmentationConfig = {
    ...params.augmentationConfig,
    applyOnlyToTrain: true,
  };
  try {
    await updateDoc(doc(db, 'datasets', params.datasetId), {
      augmentationConfig: safeCfg,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `datasets/${params.datasetId}`);
  }
}

export async function syncDatasetCounters(params: {
  datasetId: string;
  imageCount: number;
  annotatedCount: number;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'datasets', params.datasetId), {
      imageCount: Math.max(0, params.imageCount),
      annotatedCount: Math.max(0, params.annotatedCount),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `datasets/${params.datasetId}`);
  }
}

export async function addDatasetItem(params: {
  datasetId: string;
  projectId: string;
  ownerUid: string;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  sourceType: DatasetSourceType;
  split: DatasetSplit;
  classificationLabel: string;
  annotations: BoundingBox[];
  blurScore: number;
  isApproved?: boolean;
}): Promise<DatasetItem> {
  const itemId = makeId('img');
  const item: DatasetItem = {
    id: itemId,
    datasetId: params.datasetId,
    projectId: params.projectId,
    ownerUid: params.ownerUid,
    filename: params.filename.trim().slice(0, 180) || `${itemId}.jpg`,
    mimeType: params.mimeType,
    width: Math.max(1, Math.min(16384, Math.round(params.width))),
    height: Math.max(1, Math.min(16384, Math.round(params.height))),
    sizeBytes: Math.max(1, Math.min(52_428_800, Math.round(params.sizeBytes))),
    sha256: params.sha256,
    sourceType: params.sourceType,
    split: params.split,
    classificationLabel: params.classificationLabel.trim().slice(0, 80),
    annotations: params.annotations.slice(0, 100),
    blurScore: Math.max(0, params.blurScore),
    isApproved: Boolean(params.isApproved),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'datasets', params.datasetId, 'items', itemId), item);
    return item;
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `datasets/${params.datasetId}/items/${itemId}`
    );
  }
}

export async function updateDatasetItemAnnotation(params: {
  datasetId: string;
  itemId: string;
  classificationLabel: string;
  annotations: BoundingBox[];
  isApproved: boolean;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'datasets', params.datasetId, 'items', params.itemId), {
      classificationLabel: params.classificationLabel.trim().slice(0, 80),
      annotations: params.annotations.slice(0, 100),
      isApproved: params.isApproved,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `datasets/${params.datasetId}/items/${params.itemId}`
    );
  }
}

export async function applyBulkItemSplits(params: {
  datasetId: string;
  updates: { itemId: string; split: DatasetSplit }[];
}): Promise<void> {
  if (params.updates.length === 0) return;
  try {
    // Firestore writeBatch limit is 500 operations
    for (let i = 0; i < params.updates.length; i += 450) {
      const batch = writeBatch(db);
      const slice = params.updates.slice(i, i + 450);
      for (const u of slice) {
        batch.update(doc(db, 'datasets', params.datasetId, 'items', u.itemId), {
          split: u.split,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `datasets/${params.datasetId}/items`
    );
  }
}

export async function deleteDatasetItem(
  datasetId: string,
  itemId: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'datasets', datasetId, 'items', itemId));
    await deleteMediaBlob(itemId).catch(() => {});
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `datasets/${datasetId}/items/${itemId}`
    );
  }
}

export async function deleteDataset(
  datasetId: string,
  projectId: string,
  newDatasetCount: number
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'datasets', datasetId));
    await deleteDatasetMediaBlobs(datasetId).catch(() => {});
    await updateDoc(doc(db, 'projects', projectId), {
      datasetCount: Math.max(0, newDatasetCount),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `datasets/${datasetId}`);
  }
}

// --- Phase 3: Real AI Training Engine & Trained Models Services ---

export function subscribeUserTrainingRuns(
  ownerUid: string,
  onData: (runs: TrainingRun[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'trainingRuns'),
    where('ownerUid', '==', ownerUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as TrainingRun);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items.slice(0, 20));
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'trainingRuns');
    }
  );
}

export function subscribeProjectTrainingRuns(
  projectId: string,
  ownerUid: string,
  onData: (runs: TrainingRun[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'trainingRuns'),
    where('ownerUid', '==', ownerUid),
    where('projectId', '==', projectId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as TrainingRun);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'trainingRuns');
    }
  );
}

export function subscribeProjectTrainedModels(
  projectId: string,
  ownerUid: string,
  onData: (models: TrainedModel[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'trainedModels'),
    where('ownerUid', '==', ownerUid),
    where('projectId', '==', projectId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as TrainedModel);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'trainedModels');
    }
  );
}

export async function createTrainingRun(params: {
  runId?: string;
  ownerUid: string;
  projectId: string;
  datasetId: string;
  datasetVersion: number;
  taskType: V1TaskType;
  backendEngine: TrainingBackendEngine;
  architecture: string;
  trainingMode: TrainingMode;
  hyperparameters: TrainingHyperparameters;
  hardwareSummary: string;
  currentModelCount: number;
}): Promise<TrainingRun> {
  const runId = params.runId || makeId('run');
  const safeHp: TrainingHyperparameters = {
    epochs: Math.max(1, Math.min(200, Math.round(params.hyperparameters.epochs))),
    batchSize: Math.max(1, Math.min(128, Math.round(params.hyperparameters.batchSize))),
    learningRate: Math.max(0.00001, Math.min(1, Number(params.hyperparameters.learningRate))),
    optimizer: params.hyperparameters.optimizer,
    inputSize: Math.max(32, Math.min(1024, Math.round(params.hyperparameters.inputSize))),
    confidenceThreshold: Math.max(0, Math.min(1, Number(params.hyperparameters.confidenceThreshold))),
    iouThreshold: Math.max(0, Math.min(1, Number(params.hyperparameters.iouThreshold))),
    earlyStoppingPatience: Math.max(0, Math.min(50, Math.round(params.hyperparameters.earlyStoppingPatience))),
    saveCheckpoints: Boolean(params.hyperparameters.saveCheckpoints),
  };

  const runData: TrainingRun = {
    id: runId,
    projectId: params.projectId,
    datasetId: params.datasetId,
    datasetVersion: Math.max(1, Math.min(1000, params.datasetVersion)),
    ownerUid: params.ownerUid,
    taskType: params.taskType,
    backendEngine: params.backendEngine,
    architecture: params.architecture.slice(0, 64),
    trainingMode: params.trainingMode,
    hyperparameters: safeHp,
    status: 'running',
    currentEpoch: 0,
    totalEpochs: safeHp.epochs,
    epochMetrics: [],
    bestEpoch: 0,
    bestValMetric: 0,
    checkpointSaved: false,
    hardwareSummary: params.hardwareSummary.slice(0, 180),
    errorMessage: '',
    completedAt: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'trainingRuns', runId), runData);
    await updateDoc(doc(db, 'projects', params.projectId), {
      modelCount: Math.max(0, params.currentModelCount),
      status: 'training',
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'training_started',
      targetType: 'training_run',
      targetName: params.architecture,
    });
    return runData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `trainingRuns/${runId}`);
  }
}

export async function updateTrainingRunProgress(params: {
  runId: string;
  status: TrainingStatus;
  currentEpoch: number;
  epochMetrics: EpochMetricPoint[];
  bestEpoch: number;
  bestValMetric: number;
  checkpointSaved: boolean;
  hardwareSummary: string;
  errorMessage?: string;
  completedAt?: string;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'trainingRuns', params.runId), {
      status: params.status,
      currentEpoch: Math.max(0, Math.min(200, params.currentEpoch)),
      epochMetrics: params.epochMetrics.slice(-200),
      bestEpoch: Math.max(0, Math.min(200, params.bestEpoch)),
      bestValMetric: Math.max(0, params.bestValMetric),
      checkpointSaved: Boolean(params.checkpointSaved),
      hardwareSummary: params.hardwareSummary.slice(0, 180),
      errorMessage: (params.errorMessage || '').slice(0, 500),
      completedAt: (params.completedAt || '').slice(0, 64),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `trainingRuns/${params.runId}`);
  }
}

export async function updateTrainingRunStatus(params: {
  runId: string;
  status: TrainingStatus;
  completedAt?: string;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'trainingRuns', params.runId), {
      status: params.status,
      completedAt: (params.completedAt || '').slice(0, 64),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `trainingRuns/${params.runId}`);
  }
}

export async function saveTrainedModelRecord(params: {
  modelId: string;
  runId: string;
  projectId: string;
  datasetId: string;
  datasetVersion: number;
  ownerUid: string;
  name: string;
  taskType: V1TaskType;
  backendEngine: TrainingBackendEngine;
  architecture: string;
  license: string;
  classes: string[];
  inputSize: number;
  parameterCount: number;
  weightSizeBytes: number;
  inferenceLatencyMs: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  mAP50: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
  onDeviceCompatible: boolean;
  newModelCount: number;
}): Promise<TrainedModel> {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, Number(v.toFixed(4))));

  const modelData: TrainedModel = {
    id: params.modelId,
    runId: params.runId,
    projectId: params.projectId,
    datasetId: params.datasetId,
    datasetVersion: Math.max(1, Math.min(1000, params.datasetVersion)),
    ownerUid: params.ownerUid,
    name: params.name.trim().slice(0, 120) || 'Trained Model',
    taskType: params.taskType,
    backendEngine: params.backendEngine,
    architecture: params.architecture.slice(0, 64),
    license: params.license.slice(0, 80),
    classes: params.classes.slice(0, 50),
    inputSize: Math.max(32, Math.min(1024, Math.round(params.inputSize))),
    parameterCount: Math.max(0, Math.round(params.parameterCount)),
    weightSizeBytes: Math.max(0, Math.round(params.weightSizeBytes)),
    inferenceLatencyMs: Math.max(0, Number(params.inferenceLatencyMs.toFixed(2))),
    accuracy: clamp01(params.accuracy),
    precision: clamp01(params.precision),
    recall: clamp01(params.recall),
    f1Score: clamp01(params.f1Score),
    mAP50: clamp01(params.mAP50),
    confusionLabels: params.confusionLabels.slice(0, 50),
    confusionFlat: params.confusionFlat.slice(0, 2500),
    perClassMetrics: params.perClassMetrics.slice(0, 50),
    onDeviceCompatible: Boolean(params.onDeviceCompatible),
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'trainedModels', params.modelId), modelData);
    await updateDoc(doc(db, 'projects', params.projectId), {
      modelCount: Math.max(1, params.newModelCount),
      status: 'trained',
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'training_completed',
      targetType: 'model',
      targetName: modelData.name,
    });
    return modelData;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `trainedModels/${params.modelId}`);
  }
}

export async function setActiveTrainedModel(
  models: TrainedModel[],
  selectedModelId: string,
  auditContext?: { ownerUid: string; projectId: string; modelName: string }
): Promise<void> {
  try {
    const batch = writeBatch(db);
    for (const m of models) {
      const shouldBeActive = m.id === selectedModelId;
      if (m.isActive !== shouldBeActive) {
        batch.update(doc(db, 'trainedModels', m.id), {
          isActive: shouldBeActive,
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
    if (auditContext) {
      await logActivity({
        ownerUid: auditContext.ownerUid,
        projectId: auditContext.projectId,
        action: 'model_activated',
        targetType: 'model',
        targetName: auditContext.modelName,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `trainedModels/${selectedModelId}`);
  }
}

export async function renameTrainedModel(params: {
  modelId: string;
  newName: string;
}): Promise<void> {
  const cleanName = params.newName.trim().slice(0, 120);
  if (cleanName.length < 2) {
    throw new Error('Model name must be at least 2 characters.');
  }
  try {
    await updateDoc(doc(db, 'trainedModels', params.modelId), {
      name: cleanName,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `trainedModels/${params.modelId}`);
  }
}

export async function deleteTrainedModel(
  modelId: string,
  projectId: string,
  remainingModelCount: number,
  auditContext?: { ownerUid: string; modelName: string }
): Promise<void> {
  try {
    await deleteDoc(doc(db, 'trainedModels', modelId));
    await deleteStoredModelRecord(modelId).catch(() => {});
    await updateDoc(doc(db, 'projects', projectId), {
      modelCount: Math.max(0, remainingModelCount),
      status: remainingModelCount > 0 ? 'trained' : 'dataset_ready',
      updatedAt: serverTimestamp(),
    });
    if (auditContext) {
      await logActivity({
        ownerUid: auditContext.ownerUid,
        projectId,
        action: 'model_deleted',
        targetType: 'model',
        targetName: auditContext.modelName,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `trainedModels/${modelId}`);
  }
}

// --- Phase 4: Evaluation Reports & Model Hub Services ---

export function subscribeProjectEvaluationReports(
  projectId: string,
  ownerUid: string,
  onData: (reports: EvaluationReport[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'evaluationReports'),
    where('ownerUid', '==', ownerUid),
    where('projectId', '==', projectId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as EvaluationReport);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'evaluationReports');
    }
  );
}

export async function saveEvaluationReport(params: {
  projectId: string;
  modelId: string;
  modelName: string;
  datasetId: string;
  datasetVersion: number;
  ownerUid: string;
  taskType: V1TaskType;
  split: EvaluationSplitTarget;
  sampleCount: number;
  confidenceThreshold: number;
  iouThreshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  mAP50: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  confusionLabels: string[];
  confusionFlat: number[];
  perClassMetrics: PerClassMetric[];
}): Promise<EvaluationReport> {
  const reportId = makeId('eval');
  const clamp01 = (v: number) => Math.max(0, Math.min(1, Number(v.toFixed(4))));
  const report: EvaluationReport = {
    id: reportId,
    projectId: params.projectId,
    modelId: params.modelId,
    modelName: params.modelName.trim().slice(0, 120) || 'Evaluated Model',
    datasetId: params.datasetId,
    datasetVersion: Math.max(1, Math.min(1000, params.datasetVersion)),
    ownerUid: params.ownerUid,
    taskType: params.taskType,
    split: params.split,
    sampleCount: Math.max(1, Math.min(50000, Math.round(params.sampleCount))),
    confidenceThreshold: clamp01(params.confidenceThreshold),
    iouThreshold: clamp01(params.iouThreshold),
    accuracy: clamp01(params.accuracy),
    precision: clamp01(params.precision),
    recall: clamp01(params.recall),
    f1Score: clamp01(params.f1Score),
    mAP50: clamp01(params.mAP50),
    avgLatencyMs: Math.max(0, Number(params.avgLatencyMs.toFixed(2))),
    p95LatencyMs: Math.max(0, Number(params.p95LatencyMs.toFixed(2))),
    confusionLabels: params.confusionLabels.slice(0, 50),
    confusionFlat: params.confusionFlat.slice(0, 2500),
    perClassMetrics: params.perClassMetrics.slice(0, 50),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'evaluationReports', reportId), report);
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'model_evaluated',
      targetType: 'model',
      targetName: report.modelName,
    });
    return report;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `evaluationReports/${reportId}`);
  }
}

export async function deleteEvaluationReport(reportId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'evaluationReports', reportId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `evaluationReports/${reportId}`);
  }
}

// --- Phase 5: MK App Builder Services ---

export function subscribeProjectGeneratedApps(
  projectId: string,
  ownerUid: string,
  onData: (apps: GeneratedApp[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'generatedApps'),
    where('ownerUid', '==', ownerUid),
    where('projectId', '==', projectId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as GeneratedApp);
      items.sort((a, b) => toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt));
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'generatedApps');
    }
  );
}

function normalizeThemeHex(hex: string): string {
  const trimmed = hex.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : '#DC2626';
}

function normalizeInputSources(sources: AppInputSource[]): AppInputSource[] {
  const valid: AppInputSource[] = Array.from(
    new Set(sources.filter((s): s is AppInputSource => s === 'camera' || s === 'upload' || s === 'video'))
  ).slice(0, 3);
  return valid.length > 0 ? valid : ['upload'];
}

function sanitizeCustomIconDataUrl(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (
    trimmed.length <= 150000 &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)
  ) {
    return trimmed;
  }
  return '';
}

export async function createGeneratedApp(params: {
  ownerUid: string;
  projectId: string;
  modelId: string;
  modelName: string;
  taskType: V1TaskType;
  name: string;
  shortName: string;
  description: string;
  tier: AppTier;
  themeColor: string;
  backgroundColor: ThemeMode;
  runtimeTarget: AppRuntimeTarget;
  inputSources: AppInputSource[];
  confidenceThreshold: number;
  iouThreshold: number;
  showConfidence: boolean;
  showLatency: boolean;
  showHistory: boolean;
  allowCsvExport: boolean;
  customHeaderTitle: string;
  alertEnabled: boolean;
  alertTargetClass: string;
  alertMinConfidence: number;
  customIconDataUrl?: string;
  currentAppCount: number;
  projectStatus: ProjectStatus;
}): Promise<GeneratedApp> {
  const cleanName = params.name.trim().slice(0, 80);
  if (cleanName.length < 2) {
    throw new Error('App name must be at least 2 characters.');
  }
  const cleanShort = (params.shortName.trim() || cleanName).slice(0, 12);
  if (cleanShort.length < 1) {
    throw new Error('App short name is required (1–12 chars).');
  }

  const appId = makeId('app');
  const clamp01 = (v: number) => Math.max(0, Math.min(1, Number(v.toFixed(2))));

  const appRecord: GeneratedApp = {
    id: appId,
    projectId: params.projectId,
    modelId: params.modelId,
    modelName: params.modelName.trim().slice(0, 120) || 'Trained Model',
    ownerUid: params.ownerUid,
    taskType: params.taskType,
    name: cleanName,
    shortName: cleanShort,
    description: params.description.trim().slice(0, 300),
    tier: params.tier,
    themeColor: normalizeThemeHex(params.themeColor),
    backgroundColor: params.backgroundColor,
    runtimeTarget: params.runtimeTarget,
    inputSources: normalizeInputSources(params.inputSources),
    confidenceThreshold: clamp01(params.confidenceThreshold),
    iouThreshold: clamp01(params.iouThreshold),
    showConfidence: Boolean(params.showConfidence),
    showLatency: Boolean(params.showLatency),
    showHistory: Boolean(params.showHistory),
    allowCsvExport: Boolean(params.allowCsvExport),
    customHeaderTitle: params.customHeaderTitle.trim().slice(0, 80),
    alertEnabled: Boolean(params.alertEnabled),
    alertTargetClass: params.alertTargetClass.trim().slice(0, 80),
    alertMinConfidence: clamp01(params.alertMinConfidence),
    customIconDataUrl: sanitizeCustomIconDataUrl(params.customIconDataUrl),
    status: 'ready',
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'generatedApps', appId), appRecord);
    await updateDoc(doc(db, 'projects', params.projectId), {
      appCount: Math.max(1, params.currentAppCount + 1),
      status: params.projectStatus,
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'app_created',
      targetType: 'app',
      targetName: cleanName,
    });
    return appRecord;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `generatedApps/${appId}`);
  }
}

export async function updateGeneratedApp(params: {
  appId: string;
  ownerUid: string;
  projectId: string;
  modelId: string;
  modelName: string;
  name: string;
  shortName: string;
  description: string;
  tier: AppTier;
  themeColor: string;
  backgroundColor: ThemeMode;
  runtimeTarget: AppRuntimeTarget;
  inputSources: AppInputSource[];
  confidenceThreshold: number;
  iouThreshold: number;
  showConfidence: boolean;
  showLatency: boolean;
  showHistory: boolean;
  allowCsvExport: boolean;
  customHeaderTitle: string;
  alertEnabled: boolean;
  alertTargetClass: string;
  alertMinConfidence: number;
  customIconDataUrl?: string;
  status: GeneratedAppStatus;
  nextVersion: number;
}): Promise<void> {
  const cleanName = params.name.trim().slice(0, 80);
  if (cleanName.length < 2) {
    throw new Error('App name must be at least 2 characters.');
  }
  const cleanShort = (params.shortName.trim() || cleanName).slice(0, 12);
  const clamp01 = (v: number) => Math.max(0, Math.min(1, Number(v.toFixed(2))));

  try {
    await updateDoc(doc(db, 'generatedApps', params.appId), {
      modelId: params.modelId,
      modelName: params.modelName.trim().slice(0, 120) || 'Trained Model',
      name: cleanName,
      shortName: cleanShort,
      description: params.description.trim().slice(0, 300),
      tier: params.tier,
      themeColor: normalizeThemeHex(params.themeColor),
      backgroundColor: params.backgroundColor,
      runtimeTarget: params.runtimeTarget,
      inputSources: normalizeInputSources(params.inputSources),
      confidenceThreshold: clamp01(params.confidenceThreshold),
      iouThreshold: clamp01(params.iouThreshold),
      showConfidence: Boolean(params.showConfidence),
      showLatency: Boolean(params.showLatency),
      showHistory: Boolean(params.showHistory),
      allowCsvExport: Boolean(params.allowCsvExport),
      customHeaderTitle: params.customHeaderTitle.trim().slice(0, 80),
      alertEnabled: Boolean(params.alertEnabled),
      alertTargetClass: params.alertTargetClass.trim().slice(0, 80),
      alertMinConfidence: clamp01(params.alertMinConfidence),
      customIconDataUrl: sanitizeCustomIconDataUrl(params.customIconDataUrl),
      status: params.status,
      version: Math.max(1, Math.min(1000, Math.round(params.nextVersion))),
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'app_updated',
      targetType: 'app',
      targetName: cleanName,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `generatedApps/${params.appId}`);
  }
}

export async function deleteGeneratedApp(params: {
  appId: string;
  projectId: string;
  ownerUid: string;
  appName: string;
  remainingAppCount: number;
  projectStatus: ProjectStatus;
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'generatedApps', params.appId));
    await updateDoc(doc(db, 'projects', params.projectId), {
      appCount: Math.max(0, params.remainingAppCount),
      status: params.projectStatus,
      updatedAt: serverTimestamp(),
    });
    await logActivity({
      ownerUid: params.ownerUid,
      projectId: params.projectId,
      action: 'app_deleted',
      targetType: 'app',
      targetName: params.appName,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `generatedApps/${params.appId}`);
  }
}


