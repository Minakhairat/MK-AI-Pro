import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveConfinedPath } from './storageManager.ts';

const execFileAsync = promisify(execFile);

export const ALLOWED_PYTHON_BOOTSTRAP_ORIGINS = [
  'https://www.python.org/',
  'https://bootstrap.pypa.io/',
];

export interface PythonVersionManifest {
  pythonEmbeddable: {
    version: string;
    arch: string;
    downloadUrl: string;
    getPipUrl: string;
    sha256?: string;
  };
}

export interface PythonRuntimeProbe {
  ready: boolean;
  isolated: boolean;
  pythonExecutable: string | null;
  pythonVersion: string | null;
  venvPath: string | null;
  pipAvailable: boolean;
  source: 'bundled_embedded' | 'appdata_embedded' | 'isolated_venv' | 'none';
}

export function validateBootstrapUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error(`Insecure Python bootstrap URL blocked: ${parsed.protocol}`);
  }
  const normalized = parsed.toString();
  if (!ALLOWED_PYTHON_BOOTSTRAP_ORIGINS.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`Untrusted Python runtime host rejected: ${parsed.origin}`);
  }
  return parsed;
}

export class PythonRuntimeManager {
  private runtimeRoot: string;
  private bundledRuntimeDir: string | null;
  private versionsManifestPath: string;

  constructor(params: {
    userDataRoot: string;
    bundledRuntimeDir?: string | null;
    versionsManifestPath: string;
  }) {
    this.runtimeRoot = path.resolve(params.userDataRoot, 'python-env');
    this.bundledRuntimeDir = params.bundledRuntimeDir ? path.resolve(params.bundledRuntimeDir) : null;
    this.versionsManifestPath = path.resolve(params.versionsManifestPath);
    fs.mkdirSync(this.runtimeRoot, { recursive: true });
  }

  getIsolatedEnvVars(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PYTHONNOUSERSITE: '1',
      PYTHONPATH: '',
      PYTHONHOME: '',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PIP_NO_WARN_SCRIPT_LOCATION: '1',
    };
  }

  private getEmbeddedPythonExe(baseDir: string): string {
    return process.platform === 'win32'
      ? path.join(baseDir, 'python.exe')
      : path.join(baseDir, 'bin', 'python3');
  }

  private getVenvPythonExe(venvDir: string): string {
    return process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');
  }

  private readManifest(): PythonVersionManifest {
    const raw = fs.readFileSync(this.versionsManifestPath, 'utf8');
    return JSON.parse(raw) as PythonVersionManifest;
  }

  async inspectRuntime(): Promise<PythonRuntimeProbe> {
    const venvDir = resolveConfinedPath(this.runtimeRoot, 'venv');
    const venvExe = this.getVenvPythonExe(venvDir);
    if (fs.existsSync(venvExe)) {
      const check = await this.verifyPythonBinary(venvExe);
      if (check.ok) {
        return {
          ready: true,
          isolated: true,
          pythonExecutable: venvExe,
          pythonVersion: check.version,
          venvPath: venvDir,
          pipAvailable: check.pipAvailable,
          source: 'isolated_venv',
        };
      }
    }

    const appDataEmbedDir = resolveConfinedPath(this.runtimeRoot, 'embedded');
    const appDataEmbedExe = this.getEmbeddedPythonExe(appDataEmbedDir);
    if (fs.existsSync(appDataEmbedExe)) {
      const check = await this.verifyPythonBinary(appDataEmbedExe);
      if (check.ok) {
        return {
          ready: true,
          isolated: true,
          pythonExecutable: appDataEmbedExe,
          pythonVersion: check.version,
          venvPath: appDataEmbedDir,
          pipAvailable: check.pipAvailable,
          source: 'appdata_embedded',
        };
      }
    }

    if (this.bundledRuntimeDir) {
      const bundledExe = this.getEmbeddedPythonExe(this.bundledRuntimeDir);
      if (fs.existsSync(bundledExe)) {
        const check = await this.verifyPythonBinary(bundledExe);
        if (check.ok) {
          return {
            ready: true,
            isolated: true,
            pythonExecutable: bundledExe,
            pythonVersion: check.version,
            venvPath: this.bundledRuntimeDir,
            pipAvailable: check.pipAvailable,
            source: 'bundled_embedded',
          };
        }
      }
    }

    return {
      ready: false,
      isolated: false,
      pythonExecutable: null,
      pythonVersion: null,
      venvPath: null,
      pipAvailable: false,
      source: 'none',
    };
  }

  async verifyPythonBinary(
    pythonExe: string
  ): Promise<{ ok: boolean; version: string | null; pipAvailable: boolean }> {
    try {
      const { stdout } = await execFileAsync(
        pythonExe,
        [
          '-c',
          'import sys, importlib.util; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}|{importlib.util.find_spec(\\"pip\\") is not None}")',
        ],
        {
          timeout: 8000,
          windowsHide: true,
          env: this.getIsolatedEnvVars(),
        }
      );
      const [ver, pipFlag] = stdout.trim().split('|');
      return {
        ok: Boolean(ver),
        version: ver || null,
        pipAvailable: pipFlag === 'True',
      };
    } catch {
      return { ok: false, version: null, pipAvailable: false };
    }
  }

  /**
   * Ensures an isolated embedded Python runtime exists inside MK AI's own directory.
   * Never uses the user's globally installed Python on PATH.
   */
  async ensureIsolatedRuntime(onLog?: (msg: string) => void): Promise<PythonRuntimeProbe> {
    const existing = await this.inspectRuntime();
    if (existing.ready && existing.pipAvailable) {
      return existing;
    }

    // If bundled embedded Python exists (without isolated writable venv yet), mirror into writable runtime dir on Windows
    if (this.bundledRuntimeDir && fs.existsSync(this.bundledRuntimeDir)) {
      const bundledExe = this.getEmbeddedPythonExe(this.bundledRuntimeDir);
      if (fs.existsSync(bundledExe)) {
        const targetEmbed = resolveConfinedPath(this.runtimeRoot, 'embedded');
        if (!fs.existsSync(this.getEmbeddedPythonExe(targetEmbed))) {
          onLog?.('Staging bundled isolated Python runtime into AppData...');
          fs.cpSync(this.bundledRuntimeDir, targetEmbed, { recursive: true, force: true });
        }
        const stagedExe = this.getEmbeddedPythonExe(targetEmbed);
        await this.enableEmbeddedSitePackages(targetEmbed);
        const check = await this.verifyPythonBinary(stagedExe);
        if (check.ok && !check.pipAvailable) {
          await this.bootstrapPip(stagedExe, onLog);
        }
        return this.inspectRuntime();
      }
    }

    if (process.platform !== 'win32') {
      throw new Error(
        'Packaged Windows Python Embedded runtime not found. On Linux dev hosts, stage build/python-bundle or run ai_engine in Docker/venv.'
      );
    }

    // Online bootstrap of official Python Embeddable ZIP for Windows
    const manifest = this.readManifest();
    const url = validateBootstrapUrl(manifest.pythonEmbeddable.downloadUrl);
    const embedDir = resolveConfinedPath(this.runtimeRoot, 'embedded');
    fs.mkdirSync(embedDir, { recursive: true });
    const zipPath = resolveConfinedPath(this.runtimeRoot, 'python-embed.zip');

    onLog?.(`Downloading isolated Python ${manifest.pythonEmbeddable.version} runtime...`);
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Python runtime download failed (${res.status} ${res.statusText}).`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (
      manifest.pythonEmbeddable.sha256 &&
      sha.toLowerCase() !== manifest.pythonEmbeddable.sha256.toLowerCase()
    ) {
      throw new Error('Downloaded Python embeddable runtime failed SHA-256 verification.');
    }
    fs.writeFileSync(zipPath, buf);

    onLog?.('Extracting isolated Python runtime...');
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${embedDir.replace(/'/g, "''")}' -Force`,
      ],
      { timeout: 120000, windowsHide: true }
    );
    fs.rmSync(zipPath, { force: true });

    await this.enableEmbeddedSitePackages(embedDir);
    const pyExe = this.getEmbeddedPythonExe(embedDir);
    await this.bootstrapPip(pyExe, onLog);

    return this.inspectRuntime();
  }

  private async enableEmbeddedSitePackages(embedDir: string): Promise<void> {
    if (!fs.existsSync(embedDir)) return;
    for (const file of fs.readdirSync(embedDir)) {
      if (file.endsWith('._pth')) {
        const pthPath = path.join(embedDir, file);
        const content = fs.readFileSync(pthPath, 'utf8');
        const updated = content.replace(/^#\s*import site/m, 'import site');
        if (updated !== content) {
          fs.writeFileSync(pthPath, updated, 'utf8');
        }
      }
    }
  }

  private async bootstrapPip(pythonExe: string, onLog?: (msg: string) => void): Promise<void> {
    const manifest = this.readManifest();
    const pipUrl = validateBootstrapUrl(manifest.pythonEmbeddable.getPipUrl);
    const getPipPath = resolveConfinedPath(this.runtimeRoot, 'get-pip.py');
    onLog?.('Bootstrapping isolated pip package manager...');
    const res = await fetch(pipUrl.toString());
    if (!res.ok) {
      throw new Error(`Failed to download get-pip.py (${res.status}).`);
    }
    fs.writeFileSync(getPipPath, Buffer.from(await res.arrayBuffer()));
    try {
      await execFileAsync(pythonExe, [getPipPath, '--no-warn-script-location'], {
        timeout: 180000,
        windowsHide: true,
        env: this.getIsolatedEnvVars(),
      });
    } finally {
      fs.rmSync(getPipPath, { force: true });
    }
  }

  async freezeRollbackSnapshot(): Promise<string | null> {
    const probe = await this.inspectRuntime();
    if (!probe.ready || !probe.pythonExecutable) return null;
    try {
      const { stdout } = await execFileAsync(
        probe.pythonExecutable,
        ['-m', 'pip', 'freeze'],
        { timeout: 15000, windowsHide: true, env: this.getIsolatedEnvVars() }
      );
      const snapshotPath = resolveConfinedPath(this.runtimeRoot, 'rollback-requirements.txt');
      fs.writeFileSync(snapshotPath, stdout, 'utf8');
      return snapshotPath;
    } catch {
      return null;
    }
  }
}
