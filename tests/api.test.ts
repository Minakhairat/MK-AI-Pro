import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { apiRouter } from '../server/routes/api.ts';
import {
  getComputeDescriptor,
  getStorageAdapter,
  LocalStorageAdapter,
  LocalStorageProvider,
  S3CompatibleStorageAdapter,
  validateStorageConfig,
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

test('Cloud Provider Adapters switch cleanly and validate only active provider config', () => {
  const local = new LocalStorageAdapter();
  assert.equal(local.describe().provider, 'local');
  assert.equal(local.resolveObjectKey('u1', 'p1', '../bad name.png'), 'local/u1/p1/.._bad_name.png');

  const s3 = new S3CompatibleStorageAdapter();
  assert.equal(s3.describe().provider, 's3');

  const active = getStorageAdapter();
  assert.ok(['local', 's3', 'gcs'].includes(active.describe().provider));

  // Local requires zero cloud credentials
  const localCheck = validateStorageConfig({ STORAGE_PROVIDER: 'local' } as NodeJS.ProcessEnv);
  assert.equal(localCheck.valid, true);
  assert.equal(localCheck.errors.length, 0);

  // S3 checks S3_BUCKET & S3_REGION (does not require GCS vars)
  const s3Missing = validateStorageConfig({ STORAGE_PROVIDER: 's3' } as NodeJS.ProcessEnv);
  assert.equal(s3Missing.valid, false);
  assert.ok(s3Missing.errors.some((e) => e.includes('S3_BUCKET')));
  assert.ok(s3Missing.errors.some((e) => e.includes('S3_REGION')));

  const s3Valid = validateStorageConfig({
    STORAGE_PROVIDER: 's3',
    S3_BUCKET: 'mk-ai-dev',
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://localhost:9000',
  } as NodeJS.ProcessEnv);
  assert.equal(s3Valid.valid, true);

  // GCS checks GCS_BUCKET & CLOUD_REGION (does not require S3 vars)
  const gcsMissing = validateStorageConfig({ STORAGE_PROVIDER: 'gcs' } as NodeJS.ProcessEnv);
  assert.equal(gcsMissing.valid, false);
  assert.ok(gcsMissing.errors.some((e) => e.includes('GCS_BUCKET')));
  assert.ok(gcsMissing.errors.some((e) => e.includes('CLOUD_REGION')));

  const gcsValid = validateStorageConfig({
    STORAGE_PROVIDER: 'gcs',
    GCS_BUCKET: 'mk-ai-prod-bucket',
    CLOUD_REGION: 'us-central1',
  } as NodeJS.ProcessEnv);
  assert.equal(gcsValid.valid, true);

  const compute = getComputeDescriptor();
  assert.equal(compute.supportsCpuWorkers, true);
});

test('LocalStorageProvider performs real put/get/list/delete and rejects path traversal', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mk-ai-storage-test-'));
  const provider = new LocalStorageProvider(tempRoot);
  try {
    const key = provider.resolveObjectKey('user1', 'proj1', 'sample.txt');
    const put = await provider.putObject(key, 'hello-mk-ai', 'text/plain');
    assert.equal(put.provider, 'local');
    assert.equal(put.sizeBytes, 11);

    const listed = await provider.listObjects('local/user1');
    assert.deepEqual(listed, [key]);

    const fetched = await provider.getObject(key);
    assert.equal(fetched?.toString('utf8'), 'hello-mk-ai');

    await provider.deleteObject(key);
    const afterDelete = await provider.getObject(key);
    assert.equal(afterDelete, null);

    await assert.rejects(
      () => provider.putObject('../../etc/passwd', 'nope'),
      /path traversal/
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
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

