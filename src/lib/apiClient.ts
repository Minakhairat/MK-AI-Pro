import { auth } from './firebase';
import type {
  AiEnginePingResponse,
  BackendHealthResponse,
  EpochMetricPoint,
  FineTuningStrategy,
  PythonWorkerCapabilities,
  SchedulerType,
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

function buildStaticHostingHealth(): BackendHealthResponse {
  return {
    status: 'static_hosting',
    staticHosting: true,
    service: 'mk-ai-static-web',
    phase: 'Static Hosting · In-Browser TensorFlow.js',
    timestamp: new Date().toISOString(),
    uptimeSeconds: 0,
    adapters: {
      storage: {
        provider: 'local',
        region: 'browser-indexeddb',
        configured: true,
        supportsPrivateLocalFirst: true,
        description:
          'Static hosting active (GitHub Pages): media blobs and model weights are stored privately in browser IndexedDB.',
      },
      compute: {
        provider: 'tfjs-browser',
        supportsCpuWorkers: true,
        supportsGpuWorkers: true,
        aiEngineConfigured: false,
      },
    },
  };
}

export async function fetchBackendHealth(): Promise<BackendHealthResponse> {
  try {
    const res = await fetch('/api/health');
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) {
      return buildStaticHostingHealth();
    }
    return (await res.json()) as BackendHealthResponse;
  } catch {
    return buildStaticHostingHealth();
  }
}

export async function pingAiEngine(): Promise<AiEnginePingResponse> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/ai-engine/ping', {
      method: 'POST',
      headers,
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) {
      return {
        reachable: false,
        status: 'not_configured',
        message: 'Static web hosting mode — in-browser TensorFlow.js neural engine active.',
        hardware: null,
      };
    }
    return (await res.json()) as AiEnginePingResponse;
  } catch {
    return {
      reachable: false,
      status: 'not_configured',
      message: 'Backend gateway unreachable — in-browser TensorFlow.js neural engine active.',
      hardware: null,
    };
  }
}

export async function fetchAiEngineCapabilities(): Promise<PythonWorkerCapabilities> {
  const fallback: PythonWorkerCapabilities = {
    reachable: false,
    torchInstalled: false,
    torchvisionInstalled: false,
    ultralyticsInstalled: false,
    timmInstalled: false,
    transformersInstalled: false,
    onnxInstalled: false,
    onnxruntimeInstalled: false,
    paddleocrInstalled: false,
    cudaAvailable: false,
    mpsAvailable: false,
    cpuCount: 0,
    supportedArchitectures: [],
  };
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/ai-engine/capabilities', { headers });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) return fallback;
    return (await res.json()) as PythonWorkerCapabilities;
  } catch {
    return fallback;
  }
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
  fineTuningStrategy?: FineTuningStrategy;
  scheduler?: SchedulerType;
  weightDecay?: number;
  multiLabel?: boolean;
  exportOnnx?: boolean;
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

