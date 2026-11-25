import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import {
  getComputeDescriptor,
  getStorageAdapter,
  validateStorageConfig,
} from '../providers/cloudAdapter.ts';

export const apiRouter = Router();

apiRouter.use(rateLimit(120, 60_000));

function getValidatedAiEngineUrl(): URL | null {
  const raw = process.env.AI_ENGINE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

apiRouter.get('/health', (_req, res) => {
  const storage = getStorageAdapter().describe();
  const compute = getComputeDescriptor();

  res.json({
    status: 'ok',
    service: 'mk-ai-api-gateway',
    phase: 'phase5_app_builder',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    adapters: {
      storage,
      compute,
    },
  });
});

apiRouter.get('/storage/status', requireAuth, (_req: AuthenticatedRequest, res) => {
  const validation = validateStorageConfig();
  const descriptor = getStorageAdapter().describe();
  res.json({
    provider: descriptor.provider,
    region: descriptor.region,
    configured: descriptor.configured,
    supportsPrivateLocalFirst: descriptor.supportsPrivateLocalFirst,
    description: descriptor.description,
    validation,
  });
});

apiRouter.get('/capabilities', (_req, res) => {
  res.json({
    platform: 'MK AI — by MK Tech',
    currentPhase: 'Phase 5 — MK App Builder',
    tasks: [
      {
        id: 'image_classification',
        version: 'v1.0',
        availableForProjectCreation: true,
        trainingEngineStatus: 'active_phase_3',
      },
      {
        id: 'object_detection',
        version: 'v1.0',
        availableForProjectCreation: true,
        trainingEngineStatus: 'active_phase_3',
      },
      {
        id: 'image_segmentation',
        version: 'v1.5',
        availableForProjectCreation: false,
        trainingEngineStatus: 'coming_soon',
      },
      {
        id: 'anomaly_detection',
        version: 'v1.5',
        availableForProjectCreation: false,
        trainingEngineStatus: 'coming_soon',
      },
      {
        id: 'pose_estimation',
        version: 'v2.0',
        availableForProjectCreation: false,
        trainingEngineStatus: 'coming_soon',
      },
      {
        id: 'ocr_text',
        version: 'v2.0',
        availableForProjectCreation: false,
        trainingEngineStatus: 'coming_soon',
      },
      {
        id: 'video_recognition',
        version: 'v2.5',
        availableForProjectCreation: false,
        trainingEngineStatus: 'coming_soon',
      },
      {
        id: 'custom',
        version: 'v2.5',
        availableForProjectCreation: false,
        trainingEngineStatus: 'coming_soon',
      },
    ],
  });
});

apiRouter.get('/session/verify', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    authenticated: true,
    uid: req.user?.uid ?? null,
    email: req.user?.email ?? null,
    emailVerified: Boolean(req.user?.email_verified),
  });
});

apiRouter.post('/ai-engine/ping', requireAuth, async (_req: AuthenticatedRequest, res) => {
  const engineUrl = getValidatedAiEngineUrl();
  if (!engineUrl) {
    res.json({
      reachable: false,
      status: 'not_configured',
      message: 'AI_ENGINE_URL is not configured on the backend server.',
      hardware: null,
    });
    return;
  }

  try {
    const target = new URL('/health', engineUrl).toString();
    const response = await fetch(target, {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      res.json({
        reachable: false,
        status: 'error',
        message: `Python AI Engine responded with HTTP ${response.status}.`,
        hardware: null,
      });
      return;
    }

    const payload = await response.json();
    res.json({
      reachable: true,
      status: 'online',
      message: 'Python FastAPI AI Engine connected.',
      hardware: payload.hardware ?? null,
      uptimeSeconds: payload.uptime_seconds ?? null,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Connection failed';
    res.json({
      reachable: false,
      status: 'offline',
      message: `Python AI Engine is offline or unreachable (${reason}).`,
      hardware: null,
    });
  }
});

const SAFE_JOB_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

apiRouter.post('/training/jobs', requireAuth, async (req: AuthenticatedRequest, res) => {
  const engineUrl = getValidatedAiEngineUrl();
  if (!engineUrl) {
    res.status(503).json({
      error: 'AI_ENGINE_URL is not configured. Use the Local Browser Neural Engine (TensorFlow.js) or configure Python AI_ENGINE_URL.',
    });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (
    !body ||
    typeof body.projectId !== 'string' ||
    typeof body.datasetId !== 'string' ||
    typeof body.architecture !== 'string' ||
    (body.taskType !== 'image_classification' && body.taskType !== 'object_detection') ||
    !Array.isArray(body.classes) ||
    body.classes.length === 0
  ) {
    res.status(400).json({ error: 'Invalid training job payload.' });
    return;
  }

  try {
    const target = new URL('/jobs/train', engineUrl).toString();
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => ({}));
    res.status(response.status).json(payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Connection failed';
    res.status(502).json({ error: `Python AI Engine unreachable: ${reason}` });
  }
});

apiRouter.get('/training/jobs/:jobId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const jobId = String(req.params.jobId || '');
  if (!SAFE_JOB_ID_REGEX.test(jobId)) {
    res.status(400).json({ error: 'Invalid jobId format.' });
    return;
  }

  const engineUrl = getValidatedAiEngineUrl();
  if (!engineUrl) {
    res.status(503).json({ error: 'AI_ENGINE_URL is not configured.' });
    return;
  }

  try {
    const target = new URL(`/jobs/${encodeURIComponent(jobId)}`, engineUrl).toString();
    const response = await fetch(target, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => ({}));
    res.status(response.status).json(payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Connection failed';
    res.status(502).json({ error: `Python AI Engine unreachable: ${reason}` });
  }
});

apiRouter.post('/training/jobs/:jobId/:action', requireAuth, async (req: AuthenticatedRequest, res) => {
  const jobId = String(req.params.jobId || '');
  const action = String(req.params.action || '');
  if (!SAFE_JOB_ID_REGEX.test(jobId) || !['pause', 'resume', 'cancel'].includes(action)) {
    res.status(400).json({ error: 'Invalid jobId or control action.' });
    return;
  }

  const engineUrl = getValidatedAiEngineUrl();
  if (!engineUrl) {
    res.status(503).json({ error: 'AI_ENGINE_URL is not configured.' });
    return;
  }

  try {
    const target = new URL(`/jobs/${encodeURIComponent(jobId)}/${action}`, engineUrl).toString();
    const response = await fetch(target, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => ({}));
    res.status(response.status).json(payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Connection failed';
    res.status(502).json({ error: `Python AI Engine unreachable: ${reason}` });
  }
});

