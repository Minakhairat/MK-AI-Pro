import fs from 'node:fs';
import path from 'node:path';
import type { ComponentVersionEntry, UpdateCheckReport } from '../../src/types/desktop.ts';
import type { LocalEngineManager } from './engineManager.ts';
import type { DesktopModelDownloadManager } from './modelDownloadManager.ts';

interface LocalVersionsManifest {
  desktopAppVersion: string;
  aiEngineVersion: string;
  dependencySchemaVersion: string;
  modelRegistryVersion: string;
  minCompatibleEngineVersion: string;
}

export function compareSemver(a: string, b: string): number {
  const cleanA = a.replace(/[^0-9.]/g, '').split('.').map((n) => Number.parseInt(n || '0', 10));
  const cleanB = b.replace(/[^0-9.]/g, '').split('.').map((n) => Number.parseInt(n || '0', 10));
  const maxLen = Math.max(cleanA.length, cleanB.length);
  for (let i = 0; i < maxLen; i++) {
    const va = cleanA[i] ?? 0;
    const vb = cleanB[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export class DesktopUpdateManager {
  private versionsManifestPath: string;
  private engine: LocalEngineManager;
  private weights: DesktopModelDownloadManager;
  private appVersion: string;

  constructor(params: {
    appVersion: string;
    versionsManifestPath: string;
    engine: LocalEngineManager;
    weights: DesktopModelDownloadManager;
  }) {
    this.appVersion = params.appVersion;
    this.versionsManifestPath = path.resolve(params.versionsManifestPath);
    this.engine = params.engine;
    this.weights = params.weights;
  }

  private readLocalManifest(): LocalVersionsManifest {
    const raw = fs.readFileSync(this.versionsManifestPath, 'utf8');
    return JSON.parse(raw) as LocalVersionsManifest;
  }

  async checkUpdates(channel: 'stable' | 'beta' = 'stable'): Promise<UpdateCheckReport> {
    const manifest = this.readLocalManifest();
    const engineStatus = await this.engine.getStatus();
    const liveEngineVer = engineStatus.version || manifest.aiEngineVersion;
    const weightsList = this.weights.listWeights();
    const engineCompatible =
      compareSemver(liveEngineVer, manifest.minCompatibleEngineVersion) >= 0;

    let remoteManifest: Partial<LocalVersionsManifest> | null = null;
    let offlineFallback = false;
    const remoteFeedUrl = process.env.MK_UPDATE_MANIFEST_URL?.trim();

    if (remoteFeedUrl && remoteFeedUrl.startsWith('https://')) {
      try {
        const res = await fetch(remoteFeedUrl, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          remoteManifest = (await res.json()) as Partial<LocalVersionsManifest>;
        } else {
          offlineFallback = true;
        }
      } catch {
        offlineFallback = true;
      }
    }

    const latestApp = remoteManifest?.desktopAppVersion || this.appVersion || manifest.desktopAppVersion;
    const latestEngine = remoteManifest?.aiEngineVersion || manifest.aiEngineVersion;
    const latestDeps = remoteManifest?.dependencySchemaVersion || manifest.dependencySchemaVersion;
    const latestRegistry = remoteManifest?.modelRegistryVersion || manifest.modelRegistryVersion;

    const entries: ComponentVersionEntry[] = [
      {
        component: 'desktop_app',
        currentVersion: this.appVersion || manifest.desktopAppVersion,
        latestVersion: latestApp,
        updateAvailable: compareSemver(latestApp, this.appVersion || manifest.desktopAppVersion) > 0,
        compatible: true,
        releaseNotes: 'MK AI Desktop Windows shell & IPC supervisor',
        rollbackAvailable: false,
      },
      {
        component: 'ai_engine',
        currentVersion: liveEngineVer,
        latestVersion: latestEngine,
        updateAvailable: compareSemver(latestEngine, liveEngineVer) > 0,
        compatible: engineCompatible,
        releaseNotes: 'Local Python FastAPI PyTorch/Ultralytics AI Engine',
        rollbackAvailable: false,
      },
      {
        component: 'python_deps',
        currentVersion: manifest.dependencySchemaVersion,
        latestVersion: latestDeps,
        updateAvailable: latestDeps !== manifest.dependencySchemaVersion,
        compatible: true,
        releaseNotes: 'Pinned CUDA/CPU Python dependency manifest',
        rollbackAvailable: true,
      },
      {
        component: 'model_registry',
        currentVersion: manifest.modelRegistryVersion,
        latestVersion: latestRegistry,
        updateAvailable: compareSemver(latestRegistry, manifest.modelRegistryVersion) > 0,
        compatible: true,
        releaseNotes: 'Computer Vision Model Hub architecture catalog',
        rollbackAvailable: false,
      },
      {
        component: 'model_weights',
        currentVersion: `${weightsList.length} cached`,
        latestVersion: `${weightsList.length} verified`,
        updateAvailable: false,
        compatible: true,
        releaseNotes: 'SHA-256 verified local model checkpoints in MK-AI-Data',
        rollbackAvailable: weightsList.some((w) => Boolean(w.previousVersionPath)),
      },
    ];

    return {
      checkedAt: new Date().toISOString(),
      channel,
      offlineFallback,
      entries,
    };
  }
}
