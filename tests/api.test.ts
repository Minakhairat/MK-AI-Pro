import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { apiRouter } from '../server/routes/api.ts';
import {
  getComputeDescriptor,
  getStorageAdapter,
  LocalStorageAdapter,
  S3CompatibleStorageAdapter,
} from '../server/providers/cloudAdapter.ts';

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

test('GET /api/health returns gateway status and cloud adapters without secrets', async () => {
  const app = buildTestApp();
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'mk-ai-api-gateway');
    assert.ok(body.adapters?.storage);
    assert.ok(body.adapters?.compute);
  } finally {
    server.close();
  }
});

test('GET /api/capabilities lists V1.0 tasks and marks future tasks as coming_soon', async () => {
  const app = buildTestApp();
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/capabilities`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const cls = body.tasks.find((t: { id: string }) => t.id === 'image_classification');
    const pose = body.tasks.find((t: { id: string }) => t.id === 'pose_estimation');
    assert.equal(cls.availableForProjectCreation, true);
    assert.equal(pose.availableForProjectCreation, false);
    assert.equal(pose.trainingEngineStatus, 'coming_soon');
  } finally {
    server.close();
  }
});

test('GET /api/session/verify rejects unauthenticated requests with 401', async () => {
  const app = buildTestApp();
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/session/verify`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/ai-engine/ping rejects unauthenticated requests with 401', async () => {
  const app = buildTestApp();
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/ai-engine/ping`, {
      method: 'POST',
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('Cloud Provider Adapters switch cleanly via environment configuration', () => {
  const local = new LocalStorageAdapter();
  assert.equal(local.describe().provider, 'local');
  assert.equal(local.resolveObjectKey('u1', 'p1', '../bad name.png'), 'local/u1/p1/.._bad_name.png');

  const s3 = new S3CompatibleStorageAdapter();
  assert.equal(s3.describe().provider, 's3');

  const active = getStorageAdapter();
  assert.ok(['local', 's3', 'gcs'].includes(active.describe().provider));

  const compute = getComputeDescriptor();
  assert.equal(compute.supportsCpuWorkers, true);
});

test('POST /api/training/jobs and control endpoints reject unauthenticated requests with 401', async () => {
  const app = buildTestApp();
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const res1 = await fetch(`http://127.0.0.1:${address.port}/api/training/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1', datasetId: 'd1', architecture: 'yolo11n' }),
    });
    assert.equal(res1.status, 401);

    const res2 = await fetch(`http://127.0.0.1:${address.port}/api/training/jobs/pyjob_123/pause`, {
      method: 'POST',
    });
    assert.equal(res2.status, 401);
  } finally {
    server.close();
  }
});

