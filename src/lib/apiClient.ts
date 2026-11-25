import { auth } from './firebase';
import type {
  AiEnginePingResponse,
  BackendHealthResponse,
  EpochMetricPoint,
  TrainingHyperparameters,
  V1TaskType,
} from '../types/domain';

async function getAuthHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchBackendHealth(): Promise<BackendHealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Health endpoint failed with HTTP ${res.status}`);
  }
  return (await res.json()) as BackendHealthResponse;
}

export async function pingAiEngine(): Promise<AiEnginePingResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/ai-engine/ping', {
    method: 'POST',
    headers,
  });
  if (!res.ok) {
    throw new Error(`AI Engine probe failed with HTTP ${res.status}`);
  }
  return (await res.json()) as AiEnginePingResponse;
}

export async function verifyServerSession(): Promise<{
  authenticated: boolean;
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/session/verify', { headers });
  if (!res.ok) {
    throw new Error(`Session verification failed with HTTP ${res.status}`);
  }
  return await res.json();
}

export interface PythonJobResponse {
  job_id: string;
  status: string;
  currentEpoch: number;
  totalEpochs: number;
  epochMetrics: EpochMetricPoint[];
  bestEpoch: number;
  bestValMetric: number;
  checkpointPath: string | null;
  errorMessage: string | null;
  logs: string[];
}

export async function startPythonTrainingJob(payload: {
  projectId: string;
  datasetId: string;
  taskType: V1TaskType;
  architecture: string;
  classes: string[];
  hyperparameters: TrainingHyperparameters;
}): Promise<PythonJobResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/training/jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  return data as PythonJobResponse;
}

export async function fetchPythonTrainingJob(jobId: string): Promise<PythonJobResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/training/jobs/${encodeURIComponent(jobId)}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  return data as PythonJobResponse;
}

export async function controlPythonTrainingJob(
  jobId: string,
  action: 'pause' | 'resume' | 'cancel'
): Promise<PythonJobResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api/training/jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: 'POST',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  return data as PythonJobResponse;
}

