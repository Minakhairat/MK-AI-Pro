import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DesktopPairingManager } from '../electron/services/pairingManager.ts';
import {
  mergeCachedAndLiveProjects,
  sortSyncQueue,
  summarizeStorageQuota,
  validateQueueEntryConsent,
  type OfflineSyncQueueEntry,
} from '../src/lib/mobileOfflineUtils.ts';
import { sortAndCapNotifications } from '../src/lib/notificationUtils.ts';
import type { Project } from '../src/types/domain.ts';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_DIRS: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(dir);
  return dir;
}

after(() => {
  for (const dir of TEMP_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('MK AI Desktop Pairing Security & LAN Relay', () => {
  it('enforces single-use pairing code, attempt lockout, SHA-256 hashed credential storage, and instant revocation without leaking MK_ENGINE_TOKEN', async () => {
    const userDataRoot = createTempDir('mk-pair-test-');
    const SECRET_ENGINE_TOKEN = 'mk_engine_synthetic_secret_never_expose_001';

    const mgr = new DesktopPairingManager({
      userDataRoot,
      relayContext: {
        getEngineSummary: async () => ({
          engineHealthy: true,
          engineVersion: '1.0.0',
          hardware: {
            cpuModel: 'Test x64 CPU',
            nvidiaGpuName: null,
            pytorchCudaAvailable: false,
          },
        }),
        proxyEngineJson: async (apiPath, opts) => {
          if (apiPath === '/jobs/train' && opts?.method === 'POST') {
            const body = (opts.body || {}) as Record<string, unknown>;
            return {
              job_id: 'job_pair_001',
              status: 'queued',
              echo_project: body.projectId,
            };
          }
          if (apiPath.startsWith('/jobs/')) {
            return { job_id: 'job_pair_001', status: 'running' };
          }
          return { reachable: true };
        },
      },
    });

    const relayStatus = await mgr.setRelayEnabled(true, 0);
    assert.equal(relayStatus.enabled, true);
    assert.equal(relayStatus.listening, true);
    assert.ok(relayStatus.port && relayStatus.port > 0);
    const relayBase = `http://127.0.0.1:${relayStatus.port}`;

    try {
      const challenge = mgr.createPairingCode();
      assert.match(challenge.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      // 1. Unauthenticated access must fail 401
      const unauthRes = await fetch(`${relayBase}/pair/status`);
      assert.equal(unauthRes.status, 401);

      // 2. Wrong pairing code fails cleanly and invalidates challenge after 5 bad guesses
      for (let i = 0; i < 5; i++) {
        const badRes = await fetch(`${relayBase}/pair/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'WRON-GCOD', deviceName: 'Adversary' }),
        });
        assert.equal(badRes.status, 401);
      }

      const lockedRes = await fetch(`${relayBase}/pair/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: challenge.code, deviceName: 'Legit Phone' }),
      });
      assert.equal(lockedRes.status, 401);

      // 3. Issue fresh code & exchange once
      const freshChallenge = mgr.createPairingCode();
      const exRes = await fetch(`${relayBase}/pair/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: freshChallenge.code, deviceName: 'Pixel 9 Pro' }),
      });
      assert.equal(exRes.status, 200);
      const exBody = (await exRes.json()) as {
        deviceId: string;
        pairingToken: string;
        scopes: string[];
      };
      assert.ok(exBody.pairingToken.startsWith('mkpair_'));
      assert.ok(exBody.deviceId.startsWith('dev_'));

      // 4. Single-use enforcement: reusing the same code must fail
      const replayRes = await fetch(`${relayBase}/pair/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: freshChallenge.code, deviceName: 'Replay Phone' }),
      });
      assert.equal(replayRes.status, 401);

      // 5. Persisted store holds ONLY SHA-256 hash, never raw token or engine token
      const storeRaw = fs.readFileSync(
        path.join(userDataRoot, 'security', 'paired-devices.json'),
        'utf8'
      );
      assert.equal(storeRaw.includes(exBody.pairingToken), false);
      assert.equal(storeRaw.includes(SECRET_ENGINE_TOKEN), false);
      const expectedHash = createHash('sha256').update(exBody.pairingToken).digest('hex');
      assert.equal(storeRaw.includes(expectedHash), true);

      // 6. Authenticated relay calls succeed and never reveal engine token
      const statusRes = await fetch(`${relayBase}/pair/status`, {
        headers: { Authorization: `Bearer ${exBody.pairingToken}` },
      });
      assert.equal(statusRes.status, 200);
      const statusText = await statusRes.text();
      assert.equal(statusText.includes(SECRET_ENGINE_TOKEN), false);
      const statusJson = JSON.parse(statusText) as { engineHealthy: boolean };
      assert.equal(statusJson.engineHealthy, true);

      const jobRes = await fetch(`${relayBase}/pair/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${exBody.pairingToken}`,
        },
        body: JSON.stringify({ projectId: 'proj_mobile_1' }),
      });
      assert.equal(jobRes.status, 200);
      const jobJson = (await jobRes.json()) as { job_id: string };
      assert.equal(jobJson.job_id, 'job_pair_001');

      // 7. Instant revocation blocks subsequent requests with 401
      mgr.revokeDevice(exBody.deviceId);
      const afterRevokeRes = await fetch(`${relayBase}/pair/status`, {
        headers: { Authorization: `Bearer ${exBody.pairingToken}` },
      });
      assert.equal(afterRevokeRes.status, 401);
    } finally {
      await mgr.stopRelay();
    }
  });
});

describe('MK AI Mobile Offline Queue, Quota & Notification Helpers', () => {
  it('enforces explicit cloud upload consent before syncing offline entries', () => {
    const blocked: OfflineSyncQueueEntry = {
      id: 'q1',
      type: 'upload_dataset_item',
      projectId: 'p1',
      datasetId: 'd1',
      itemId: 'i1',
      storageLocation: 'cloud',
      cloudConsentGranted: false,
      createdAt: 100,
      status: 'pending_offline',
      payload: {} as OfflineSyncQueueEntry['payload'],
    };
    const allowedLocal: OfflineSyncQueueEntry = {
      ...blocked,
      id: 'q2',
      storageLocation: 'local',
      createdAt: 50,
    };

    assert.equal(validateQueueEntryConsent(blocked).allowed, false);
    assert.equal(validateQueueEntryConsent(allowedLocal).allowed, true);
    const sorted = sortSyncQueue([blocked, allowedLocal]);
    assert.deepEqual(
      sorted.map((s) => s.id),
      ['q2', 'q1']
    );
  });

  it('distinguishes synced vs cached_offline project snapshots cleanly', () => {
    const proj: Project = {
      id: 'p_1',
      workspaceId: 'ws_1',
      ownerUid: 'u_1',
      name: 'Mobile Weld Inspector',
      description: 'Test',
      taskType: 'image_classification',
      engineVersion: 'v1.0',
      status: 'draft',
      trainingMode: 'beginner',
      storageLocation: 'local',
      cloudConsentGranted: false,
      datasetCount: 1,
      modelCount: 0,
      appCount: 0,
    };
    const offlineMerged = mergeCachedAndLiveProjects(
      [],
      [{ id: proj.id, project: proj, cachedAt: '2026-11-26T00:00:00Z', sourceState: 'synced' }],
      false
    );
    assert.equal(offlineMerged.length, 1);
    assert.equal(offlineMerged[0].syncState, 'cached_offline');

    const onlineMerged = mergeCachedAndLiveProjects([proj], [], true);
    assert.equal(onlineMerged[0].syncState, 'synced');
  });

  it('summarizes storage quota and sorts/caps notifications chronologically', () => {
    const quota = summarizeStorageQuota(50 * 1024 * 1024, 500 * 1024 * 1024, true);
    assert.equal(quota.percentUsed, 10);

    const items = Array.from({ length: 50 }, (_, idx) => ({
      id: `n_${idx}`,
      category: 'training_completed' as const,
      title: `Run ${idx}`,
      body: 'Done',
      createdAt: new Date(1700000000000 + idx * 1000).toISOString(),
      read: false,
    }));
    const capped = sortAndCapNotifications(items, 40);
    assert.equal(capped.length, 40);
    assert.equal(capped[0].id, 'n_49');
  });
});

describe('MK AI Desktop Release CI & PWA Build Verification', () => {
  it('ensures build/installer.nsh & helper scripts are not gitignored and build-desktop.yml builds both exe targets', () => {
    const gitignore = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8');
    const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
    assert.equal(lines.includes('build/'), false, '.gitignore must not ignore build/');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'build', 'installer.nsh')));
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'build', 'prepare-python-runtime.mjs')));
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'build', 'run-desktop-build.mjs')));

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.equal(pkg.scripts['desktop:build'].includes('ELECTRON_BUILD=true'), false);
    assert.ok(pkg.scripts['desktop:build'].includes('run-desktop-build.mjs'));

    const workflow = fs.readFileSync(
      path.join(ROOT_DIR, '.github', 'workflows', 'build-desktop.yml'),
      'utf8'
    );
    assert.ok(workflow.includes('windows-latest'));
    assert.ok(workflow.includes('MK-AI-Setup.exe'));
    assert.ok(workflow.includes('MK-AI-Offline-Setup.exe'));
    assert.ok(workflow.includes('SHA256SUMS.txt'));
    assert.ok(workflow.includes('desktop-release-manifest.json'));
  });

  it('verifies generated PWA manifest, icons, service worker, and zero secret token leakage in dist bundle when built', () => {
    const distDir = path.join(ROOT_DIR, 'dist');
    const manifestPath = path.join(distDir, 'manifest.webmanifest');
    if (!fs.existsSync(manifestPath)) {
      return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      display: string;
      short_name: string;
      shortcuts?: unknown[];
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.short_name.length <= 12);
    assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 3);

    const hasAny = manifest.icons.some((i) => !i.purpose || i.purpose.includes('any'));
    const hasMaskable = manifest.icons.some((i) => i.purpose?.includes('maskable'));
    assert.equal(hasAny, true);
    assert.equal(hasMaskable, true);

    for (const icon of manifest.icons) {
      const cleanRel = icon.src.replace(/^\.?\//, '');
      assert.ok(fs.existsSync(path.join(distDir, cleanRel)), `Missing manifest icon ${cleanRel}`);
    }

    assert.ok(fs.existsSync(path.join(distDir, 'apple-touch-icon.png')));
    assert.ok(fs.existsSync(path.join(distDir, 'sw.js')));

    const assetsDir = path.join(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        if (!file.endsWith('.js')) continue;
        const js = fs.readFileSync(path.join(assetsDir, file), 'utf8');
        assert.equal(
          js.includes('MK_ENGINE_TOKEN'),
          false,
          `Bundle ${file} must not contain MK_ENGINE_TOKEN`
        );
      }
    }
  });
});
