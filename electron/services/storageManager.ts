import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  DesktopConfig,
  DesktopStagedDatasetResult,
  StagedClassificationImageInput,
  StagedDetectionImageInput,
  StorageSubdirName,
  StorageUsageSummary,
} from '../../src/types/desktop.ts';

export const STORAGE_SUBDIRS: StorageSubdirName[] = [
  'datasets',
  'projects',
  'models',
  'model_weights',
  'training_runs',
  'exports',
  'logs',
  'cache',
  'temp',
  'backups',
];

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function resolveDefaultStorageRoot(customBase?: string): string {
  const fromEnv = process.env.LOCAL_STORAGE_DIR?.trim();
  if (customBase && customBase.trim()) {
    return path.resolve(customBase.trim());
  }
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'MK-AI-Data');
  }
  return path.join(os.homedir(), '.mk-ai-data');
}

export function resolveConfinedPath(baseDir: string, ...segments: string[]): string {
  const normalizedBase = path.resolve(baseDir);
  const resolved = path.resolve(normalizedBase, ...segments);
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error(`Path confinement violation: ${resolved} escapes ${normalizedBase}`);
  }
  return resolved;
}

export function sanitizeSegment(value: string, fallback = 'item'): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 96) || fallback;
}

function computeDirSize(dirPath: string): { bytes: number; fileCount: number } {
  if (!fs.existsSync(dirPath)) return { bytes: 0, fileCount: 0 };
  let bytes = 0;
  let fileCount = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
          fileCount += 1;
        } catch {
          // Ignore transient vanished file
        }
      }
    }
  }
  return { bytes, fileCount };
}

export class DesktopStorageManager {
  private configPath: string;
  private config: DesktopConfig;

  constructor(configDir: string, defaultStorageRoot?: string) {
    fs.mkdirSync(configDir, { recursive: true });
    this.configPath = path.join(configDir, 'mk-desktop-config.json');
    const resolvedDefault = resolveDefaultStorageRoot(defaultStorageRoot);
    this.config = this.loadOrInitConfig(resolvedDefault);
    process.env.LOCAL_STORAGE_DIR = this.config.storageRoot;
    this.ensureStructure();
  }

  private loadOrInitConfig(defaultStorageRoot: string): DesktopConfig {
    const defaults: DesktopConfig = {
      storageRoot: defaultStorageRoot,
      autoStartEngine: true,
      stopEngineOnExit: true,
      preferredProfile: 'auto',
      firstLaunchCompleted: false,
      cloudSyncConsentGranted: false,
      updateChannel: 'stable',
      selectedDevice: 'auto',
    };
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, JSON.stringify(defaults, null, 2), 'utf8');
      return defaults;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<DesktopConfig>;
      const merged: DesktopConfig = {
        ...defaults,
        ...parsed,
        storageRoot:
          typeof parsed.storageRoot === 'string' && parsed.storageRoot.trim()
            ? path.resolve(parsed.storageRoot)
            : defaultStorageRoot,
      };
      return merged;
    } catch {
      return defaults;
    }
  }

  getConfig(): DesktopConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<DesktopConfig>): DesktopConfig {
    const next: DesktopConfig = {
      ...this.config,
      ...patch,
      storageRoot:
        typeof patch.storageRoot === 'string' && patch.storageRoot.trim()
          ? path.resolve(patch.storageRoot)
          : this.config.storageRoot,
    };
    this.config = next;
    process.env.LOCAL_STORAGE_DIR = next.storageRoot;
    this.ensureStructure();
    fs.writeFileSync(this.configPath, JSON.stringify(next, null, 2), 'utf8');
    return { ...next };
  }

  getStorageRoot(): string {
    return this.config.storageRoot;
  }

  getSubdir(name: StorageSubdirName): string {
    return resolveConfinedPath(this.config.storageRoot, name);
  }

  ensureStructure(): { root: string; directories: Record<StorageSubdirName, string> } {
    fs.mkdirSync(this.config.storageRoot, { recursive: true });
    const directories = {} as Record<StorageSubdirName, string>;
    for (const sub of STORAGE_SUBDIRS) {
      const target = this.getSubdir(sub);
      fs.mkdirSync(target, { recursive: true });
      directories[sub] = target;
    }
    return { root: this.config.storageRoot, directories };
  }

  getUsageSummary(): StorageUsageSummary {
    this.ensureStructure();
    const breakdownBytes = {} as Record<StorageSubdirName, number>;
    let totalUsedBytes = 0;

    for (const sub of STORAGE_SUBDIRS) {
      const stats = computeDirSize(this.getSubdir(sub));
      breakdownBytes[sub] = stats.bytes;
      totalUsedBytes += stats.bytes;
    }

    let freeDiskBytes = 0;
    let totalDiskBytes = 0;
    try {
      const stat = fs.statfsSync(this.config.storageRoot);
      freeDiskBytes = Number(stat.bavail) * Number(stat.bsize);
      totalDiskBytes = Number(stat.blocks) * Number(stat.bsize);
    } catch {
      freeDiskBytes = 0;
      totalDiskBytes = 0;
    }

    const countDirs = (sub: StorageSubdirName) => {
      try {
        return fs.readdirSync(this.getSubdir(sub)).length;
      } catch {
        return 0;
      }
    };

    return {
      storageRoot: this.config.storageRoot,
      totalUsedBytes,
      freeDiskBytes,
      totalDiskBytes,
      breakdownBytes,
      datasetCount: countDirs('datasets'),
      modelCount: countDirs('models'),
      weightCount: countDirs('model_weights'),
      backupCount: countDirs('backups'),
    };
  }

  clearTempCache(): { clearedBytes: number; summary: StorageUsageSummary } {
    let clearedBytes = 0;
    for (const sub of ['temp', 'cache'] as const) {
      const dir = this.getSubdir(sub);
      const stats = computeDirSize(dir);
      clearedBytes += stats.bytes;
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
    return { clearedBytes, summary: this.getUsageSummary() };
  }

  createBackupSnapshot(label = 'manual'): { backupPath: string; sizeBytes: number } {
    this.ensureStructure();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = sanitizeSegment(label, 'manual');
    const backupDir = resolveConfinedPath(this.getSubdir('backups'), `backup_${stamp}_${safeLabel}`);
    fs.mkdirSync(backupDir, { recursive: true });

    const manifest = {
      createdAt: new Date().toISOString(),
      label: safeLabel,
      storageRoot: this.config.storageRoot,
      config: this.config,
    };
    const manifestPath = path.join(backupDir, 'backup-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    for (const sub of ['projects', 'models'] as const) {
      const src = this.getSubdir(sub);
      if (fs.existsSync(src)) {
        fs.cpSync(src, path.join(backupDir, sub), { recursive: true, force: true });
      }
    }
    const { bytes } = computeDirSize(backupDir);
    return { backupPath: backupDir, sizeBytes: bytes };
  }

  appendLog(filename: string, line: string): void {
    this.ensureStructure();
    const logPath = resolveConfinedPath(this.getSubdir('logs'), sanitizeSegment(filename, 'desktop.log'));
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  }

  saveProjectMetadata(project: Record<string, unknown>): { ok: boolean } {
    const id = typeof project.id === 'string' && SAFE_ID_REGEX.test(project.id) ? project.id : null;
    if (!id) throw new Error('Invalid local project id.');
    this.ensureStructure();
    const target = resolveConfinedPath(this.getSubdir('projects'), `${id}.json`);
    fs.writeFileSync(
      target,
      JSON.stringify({ ...project, localSavedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    return { ok: true };
  }

  listProjectMetadata(): Record<string, unknown>[] {
    const dir = this.getSubdir('projects');
    if (!fs.existsSync(dir)) return [];
    const results: Record<string, unknown>[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(
          fs.readFileSync(resolveConfinedPath(dir, entry), 'utf8')
        ) as Record<string, unknown>;
        results.push(parsed);
      } catch {
        // Ignore malformed local metadata file
      }
    }
    return results;
  }

  stageDatasetForTraining(params: {
    datasetId: string;
    taskType: 'image_classification' | 'object_detection';
    classes: string[];
    classificationImages?: StagedClassificationImageInput[];
    detectionImages?: StagedDetectionImageInput[];
  }): DesktopStagedDatasetResult {
    if (!SAFE_ID_REGEX.test(params.datasetId)) {
      throw new Error('Invalid datasetId for local staging.');
    }
    this.ensureStructure();
    const datasetRoot = resolveConfinedPath(this.getSubdir('datasets'), params.datasetId);
    fs.rmSync(datasetRoot, { recursive: true, force: true });
    fs.mkdirSync(datasetRoot, { recursive: true });

    let stagedCount = 0;

    if (params.taskType === 'image_classification') {
      for (const split of ['train', 'val', 'test'] as const) {
        const splitDir = resolveConfinedPath(datasetRoot, split);
        fs.mkdirSync(splitDir, { recursive: true });
        for (const cls of params.classes) {
          fs.mkdirSync(resolveConfinedPath(splitDir, sanitizeSegment(cls, 'class')), {
            recursive: true,
          });
        }
      }
      for (const img of params.classificationImages ?? []) {
        const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const clsDir = resolveConfinedPath(
          datasetRoot,
          img.split,
          sanitizeSegment(img.className, 'class')
        );
        fs.mkdirSync(clsDir, { recursive: true });
        const fileTarget = resolveConfinedPath(clsDir, `${sanitizeSegment(img.itemId)}.${ext}`);
        fs.writeFileSync(fileTarget, Buffer.from(img.base64Data, 'base64'));
        stagedCount += 1;
      }
      return {
        datasetId: params.datasetId,
        datasetDirPath: datasetRoot,
        datasetYamlPath: null,
        stagedCount,
      };
    }

    // Object detection YOLO format layout
    for (const split of ['train', 'val', 'test'] as const) {
      fs.mkdirSync(resolveConfinedPath(datasetRoot, 'images', split), { recursive: true });
      fs.mkdirSync(resolveConfinedPath(datasetRoot, 'labels', split), { recursive: true });
    }
    for (const img of params.detectionImages ?? []) {
      const ext = img.mimeType === 'image/png' ? 'png' : img.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const baseName = sanitizeSegment(img.itemId);
      const imgTarget = resolveConfinedPath(datasetRoot, 'images', img.split, `${baseName}.${ext}`);
      const lblTarget = resolveConfinedPath(datasetRoot, 'labels', img.split, `${baseName}.txt`);
      fs.writeFileSync(imgTarget, Buffer.from(img.base64Data, 'base64'));
      const yoloLines = img.boxes.map((b) => {
        const cx = Math.max(0, Math.min(1, b.x + b.width / 2));
        const cy = Math.max(0, Math.min(1, b.y + b.height / 2));
        const w = Math.max(0.001, Math.min(1, b.width));
        const h = Math.max(0.001, Math.min(1, b.height));
        return `${b.classIndex} ${cx.toFixed(6)} ${cy.toFixed(6)} ${w.toFixed(6)} ${h.toFixed(6)}`;
      });
      fs.writeFileSync(lblTarget, yoloLines.join('\n'), 'utf8');
      stagedCount += 1;
    }

    const yamlPath = resolveConfinedPath(datasetRoot, 'data.yaml');
    const escapedPath = datasetRoot.replace(/\\/g, '/');
    const yamlLines = [
      `path: "${escapedPath}"`,
      'train: images/train',
      'val: images/val',
      'test: images/test',
      `nc: ${params.classes.length}`,
      'names:',
      ...params.classes.map((c, idx) => `  ${idx}: "${c.replace(/"/g, '\\"')}"`),
    ];
    fs.writeFileSync(yamlPath, yamlLines.join('\n') + '\n', 'utf8');

    return {
      datasetId: params.datasetId,
      datasetDirPath: datasetRoot,
      datasetYamlPath: yamlPath,
      stagedCount,
    };
  }
}
