import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  DependencyInstallProgress,
  ExecutionProfile,
  PackageHealthEntry,
} from '../../src/types/desktop.ts';
import type { PythonRuntimeManager } from './pythonRuntimeManager.ts';

const execFileAsync = promisify(execFile);

export interface ManifestEntry {
  name: string;
  spec: string;
  importName: string;
  requiredForProfile: boolean;
}

export function parseRequirementsManifest(
  manifestContent: string,
  requiredForProfile = true
): { extraIndexUrl: string | null; packages: ManifestEntry[] } {
  let extraIndexUrl: string | null = null;
  const packages: ManifestEntry[] = [];

  for (const rawLine of manifestContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('--extra-index-url')) {
      const urlPart = line.replace('--extra-index-url', '').trim();
      if (urlPart.startsWith('https://')) {
        extraIndexUrl = urlPart;
      }
      continue;
    }
    const clean = line.split('[')[0];
    const match = line.match(/^([a-zA-Z0-9._-]+)(?:\[[^\]]+\])?\s*([=<>!~]+.+)?$/);
    if (!match) continue;
    const rawName = match[1].toLowerCase();
    const pkgName = clean.match(/^([a-zA-Z0-9._-]+)/)?.[1] ?? rawName;
    const importMap: Record<string, string> = {
      'onnxruntime-gpu': 'onnxruntime',
      'opencv-python-headless': 'cv2',
      pillow: 'PIL',
    };
    packages.push({
      name: pkgName,
      spec: line,
      importName: importMap[pkgName.toLowerCase()] ?? pkgName.toLowerCase().replace(/-/g, '_'),
      requiredForProfile,
    });
  }

  return { extraIndexUrl, packages };
}

export function getManifestFilenameForProfile(profile: ExecutionProfile): string {
  if (profile === 'nvidia_gpu') return 'requirements-cu121.txt';
  if (profile === 'safe_compatibility') return 'requirements-safe.txt';
  return 'requirements-cpu.txt';
}

export class DependencyManager {
  private runtimeManager: PythonRuntimeManager;
  private manifestsDir: string;
  private offlineWheelhouseDir: string | null;
  private currentProgress: DependencyInstallProgress = {
    jobId: 'idle',
    stage: 'idle',
    profile: 'cpu',
    progressPct: 0,
    currentPackage: '',
    attempt: 0,
    message: 'Idle',
    logs: [],
  };

  constructor(params: {
    runtimeManager: PythonRuntimeManager;
    manifestsDir: string;
    offlineWheelhouseDir?: string | null;
  }) {
    this.runtimeManager = params.runtimeManager;
    this.manifestsDir = path.resolve(params.manifestsDir);
    this.offlineWheelhouseDir = params.offlineWheelhouseDir
      ? path.resolve(params.offlineWheelhouseDir)
      : null;
  }

  getProgress(): DependencyInstallProgress {
    return { ...this.currentProgress, logs: [...this.currentProgress.logs] };
  }

  async auditEnvironment(profile: ExecutionProfile = 'cpu'): Promise<{
    pythonReady: boolean;
    isolatedVenv: boolean;
    packages: PackageHealthEntry[];
    issues: string[];
  }> {
    const probe = await this.runtimeManager.inspectRuntime();
    const manifestFile = path.join(this.manifestsDir, getManifestFilenameForProfile(profile));
    const parsed = parseRequirementsManifest(fs.readFileSync(manifestFile, 'utf8'), true);
    const versionsJson = JSON.parse(
      fs.readFileSync(path.join(this.manifestsDir, 'versions.json'), 'utf8')
    ) as { optionalExtras?: Record<string, string[]> };

    const optionalEntries: ManifestEntry[] = [];
    for (const extraList of Object.values(versionsJson.optionalExtras ?? {})) {
      const extraParsed = parseRequirementsManifest(extraList.join('\n'), false);
      optionalEntries.push(...extraParsed.packages);
    }

    const allEntries = [...parsed.packages];
    for (const opt of optionalEntries) {
      if (!allEntries.some((e) => e.importName === opt.importName)) {
        allEntries.push(opt);
      }
    }

    if (!probe.ready || !probe.pythonExecutable) {
      return {
        pythonReady: false,
        isolatedVenv: false,
        packages: allEntries.map((e) => ({
          name: e.name,
          requiredSpec: e.spec,
          installedVersion: null,
          status: 'missing',
          requiredForProfile: e.requiredForProfile,
        })),
        issues: ['Isolated Python runtime is not initialized yet.'],
      };
    }

    const probeScript = [
      'import importlib, importlib.metadata, json',
      `entries = ${JSON.stringify(allEntries.map((e) => ({ name: e.name, imp: e.importName })))}`,
      'res = {}',
      'for item in entries:',
      '  ver = None',
      '  corrupt = False',
      '  try:',
      '    ver = importlib.metadata.version(item["name"])',
      '  except Exception:',
      '    ver = None',
      '  if ver:',
      '    try:',
      '      importlib.import_module(item["imp"])',
      '    except Exception:',
      '      corrupt = True',
      '  res[item["name"]] = {"ver": ver, "corrupt": corrupt}',
      'print(json.dumps(res))',
    ].join('\n');

    let statusMap: Record<string, { ver: string | null; corrupt: boolean }> = {};
    try {
      const { stdout } = await execFileAsync(probe.pythonExecutable, ['-c', probeScript], {
        timeout: 20000,
        windowsHide: true,
        env: this.runtimeManager.getIsolatedEnvVars(),
      });
      statusMap = JSON.parse(stdout.trim()) as Record<string, { ver: string | null; corrupt: boolean }>;
    } catch {
      statusMap = {};
    }

    const packages: PackageHealthEntry[] = [];
    const issues: string[] = [];

    for (const entry of allEntries) {
      const info = statusMap[entry.name];
      const installedVersion = info?.ver ?? null;
      const pinnedTarget = entry.spec.includes('==') ? entry.spec.split('==')[1].split('+')[0] : null;
      let status: PackageHealthEntry['status'] = 'ok';

      if (!installedVersion) {
        status = 'missing';
        if (entry.requiredForProfile) {
          issues.push(`Missing required package: ${entry.spec}`);
        }
      } else if (info?.corrupt) {
        status = 'corrupted';
        issues.push(`Corrupted import for ${entry.name} (${installedVersion})`);
      } else if (pinnedTarget && !installedVersion.startsWith(pinnedTarget)) {
        status = 'mismatch';
        if (entry.requiredForProfile) {
          issues.push(`Version mismatch for ${entry.name}: installed ${installedVersion}, expected ${pinnedTarget}`);
        }
      }

      packages.push({
        name: entry.name,
        requiredSpec: entry.spec,
        installedVersion,
        status,
        requiredForProfile: entry.requiredForProfile,
      });
    }

    return {
      pythonReady: probe.ready,
      isolatedVenv: probe.isolated,
      packages,
      issues,
    };
  }

  async installOrRepair(params: {
    profile: ExecutionProfile;
    extras?: string[];
    repair?: boolean;
    onProgress?: (progress: DependencyInstallProgress) => void;
  }): Promise<DependencyInstallProgress> {
    const jobId = `dep_${Date.now()}`;
    const emit = (patch: Partial<DependencyInstallProgress>, logLine?: string) => {
      this.currentProgress = {
        ...this.currentProgress,
        ...patch,
        jobId,
        profile: params.profile,
        logs: logLine
          ? [...this.currentProgress.logs.slice(-80), `[${new Date().toLocaleTimeString()}] ${logLine}`]
          : this.currentProgress.logs,
      };
      params.onProgress?.(this.getProgress());
    };

    emit(
      {
        stage: 'downloading',
        progressPct: 5,
        currentPackage: 'python-runtime',
        attempt: 1,
        message: 'Verifying isolated Python runtime...',
        logs: [],
      },
      `Preparing isolated environment for profile: ${params.profile}`
    );

    const runtime = await this.runtimeManager.ensureIsolatedRuntime((m) =>
      emit({ message: m }, m)
    );
    if (!runtime.ready || !runtime.pythonExecutable) {
      emit({
        stage: 'failed',
        progressPct: 0,
        message: 'Isolated Python runtime could not be prepared.',
      });
      return this.getProgress();
    }

    const rollbackSnapshot = await this.runtimeManager.freezeRollbackSnapshot();
    const manifestPath = path.join(this.manifestsDir, getManifestFilenameForProfile(params.profile));
    const versionsJson = JSON.parse(
      fs.readFileSync(path.join(this.manifestsDir, 'versions.json'), 'utf8')
    ) as { optionalExtras?: Record<string, string[]> };

    const extraSpecs: string[] = [];
    for (const extraKey of params.extras ?? []) {
      const list = versionsJson.optionalExtras?.[extraKey];
      if (Array.isArray(list)) extraSpecs.push(...list);
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      emit(
        {
          stage: 'installing',
          attempt,
          progressPct: 20,
          currentPackage: path.basename(manifestPath),
          message: `Installing pinned dependencies (attempt ${attempt}/${maxAttempts})...`,
        },
        `Running pip install from ${path.basename(manifestPath)}`
      );

      const pipArgs = ['-m', 'pip', 'install', '--no-warn-script-location'];
      if (params.repair) {
        pipArgs.push('--force-reinstall', '--no-cache-dir');
      }
      if (this.offlineWheelhouseDir && fs.existsSync(this.offlineWheelhouseDir)) {
        pipArgs.push('--no-index', '--find-links', this.offlineWheelhouseDir);
      }
      pipArgs.push('-r', manifestPath, ...extraSpecs);

      const result = await this.runPipWithProgress(runtime.pythonExecutable, pipArgs, (line) => {
        const pctMatch = line.includes('Downloading')
          ? 45
          : line.includes('Installing collected packages')
          ? 75
          : line.includes('Successfully installed')
          ? 90
          : this.currentProgress.progressPct;
        const pkgMatch = line.match(/Collecting\s+([a-zA-Z0-9._-]+)/);
        emit(
          {
            progressPct: Math.max(this.currentProgress.progressPct, pctMatch),
            currentPackage: pkgMatch ? pkgMatch[1] : this.currentProgress.currentPackage,
            message: line.slice(0, 140),
          },
          line
        );
      });

      if (result.exitCode === 0) {
        emit(
          { stage: 'verifying', progressPct: 94, message: 'Verifying installed packages...' },
          'Auditing installed Python packages...'
        );
        const audit = await this.auditEnvironment(params.profile);
        if (audit.issues.length === 0) {
          emit(
            {
              stage: 'completed',
              progressPct: 100,
              currentPackage: 'verified',
              message: 'Python AI environment verified and ready.',
            },
            'Dependency verification completed with zero issues.'
          );
          return this.getProgress();
        }
        emit(
          {
            stage: 'failed',
            message: `Post-install verification detected issues: ${audit.issues[0]}`,
          },
          audit.issues.join(' | ')
        );
        return this.getProgress();
      }

      if (attempt < maxAttempts) {
        emit(
          {
            stage: 'downloading',
            message: `Recoverable install failure (code ${result.exitCode}), retrying...`,
          },
          `Retrying dependency install in ${attempt * 2}s...`
        );
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    // Attempt rollback if snapshot exists
    if (rollbackSnapshot && fs.existsSync(rollbackSnapshot)) {
      emit(
        {
          stage: 'rolling_back',
          message: 'Rolling back Python packages to previous working snapshot...',
        },
        'Restoring previous working dependency snapshot...'
      );
      await this.runPipWithProgress(
        runtime.pythonExecutable,
        ['-m', 'pip', 'install', '-r', rollbackSnapshot],
        () => {}
      );
    }

    emit({
      stage: 'failed',
      message: 'Dependency installation failed after retries. Check network or switch to Safe Compatibility mode.',
    });
    return this.getProgress();
  }

  private runPipWithProgress(
    pythonExe: string,
    args: string[],
    onLine: (line: string) => void
  ): Promise<{ exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn(pythonExe, args, {
        shell: false,
        windowsHide: true,
        env: this.runtimeManager.getIsolatedEnvVars(),
      });
      const handleChunk = (buf: Buffer) => {
        for (const line of buf.toString('utf8').split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) onLine(trimmed);
        }
      };
      child.stdout.on('data', handleChunk);
      child.stderr.on('data', handleChunk);
      child.on('error', (err) => {
        onLine(`Spawn error: ${err.message}`);
        resolve({ exitCode: 1 });
      });
      child.on('close', (code) => resolve({ exitCode: code ?? 1 }));
    });
  }
}
