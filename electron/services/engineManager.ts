import { type ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { EngineRuntimeStatus } from '../../src/types/desktop.ts';
import type { PythonRuntimeManager } from './pythonRuntimeManager.ts';
import { type DesktopStorageManager, resolveConfinedPath } from './storageManager.ts';

interface EngineLockFilePayload {
  pid: number;
  port: number;
  startedAt: string;
}

export async function findFreeLoopbackPort(preferredPort = 8765): Promise<number> {
  const tryListen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        const addr = srv.address();
        const chosen = typeof addr === 'object' && addr ? addr.port : port;
        srv.close(() => resolve(chosen));
      });
    });

  try {
    return await tryListen(preferredPort);
  } catch {
    return await tryListen(0);
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class LocalEngineManager {
  private storage: DesktopStorageManager;
  private runtime: PythonRuntimeManager;
  private aiEngineDir: string;
  private proc: ChildProcess | null = null;
  private token: string = '';
  private port: number | null = null;
  private version: string | null = null;
  private restartCount = 0;
  private startedAt: string | null = null;
  private lastError: string | null = null;
  private intentionallyStopping = false;

  constructor(params: {
    storage: DesktopStorageManager;
    runtime: PythonRuntimeManager;
    aiEngineDir: string;
  }) {
    this.storage = params.storage;
    this.runtime = params.runtime;
    this.aiEngineDir = path.resolve(params.aiEngineDir);
  }

  private getLockFilePath(): string {
    return resolveConfinedPath(this.storage.getSubdir('temp'), 'mk-engine.lock.json');
  }

  private getTokenHeaders(includeJson = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  getAuthToken(): string {
    return this.token;
  }

  getBaseUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }

  async checkHealth(): Promise<{ healthy: boolean; version: string | null; hardware?: Record<string, unknown> }> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) return { healthy: false, version: null };
    try {
      const res = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: this.getTokenHeaders(false),
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return { healthy: false, version: null };
      const data = (await res.json()) as {
        status?: string;
        version?: string;
        hardware?: Record<string, unknown>;
      };
      this.version = data.version ?? this.version;
      return {
        healthy: data.status === 'online',
        version: data.version ?? null,
        hardware: data.hardware,
      };
    } catch {
      return { healthy: false, version: null };
    }
  }

  async getStatus(): Promise<EngineRuntimeStatus> {
    const health = await this.checkHealth();
    const alive = Boolean(this.proc && !this.proc.killed && isProcessAlive(this.proc.pid ?? -1));
    return {
      running: alive || health.healthy,
      healthy: health.healthy,
      port: this.port,
      pid: this.proc?.pid ?? null,
      version: health.version ?? this.version,
      restartCount: this.restartCount,
      startedAt: this.startedAt,
      lastError: this.lastError,
      tokenProtected: Boolean(this.token),
      bindHost: '127.0.0.1',
    };
  }

  async start(): Promise<EngineRuntimeStatus> {
    if (this.proc && isProcessAlive(this.proc.pid ?? -1)) {
      const existingHealth = await this.checkHealth();
      if (existingHealth.healthy) {
        return this.getStatus();
      }
    }

    // Prevent duplicate orphaned instances from prior runs
    const lockPath = this.getLockFilePath();
    if (fs.existsSync(lockPath)) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as EngineLockFilePayload;
        if (isProcessAlive(lock.pid) && lock.pid !== process.pid) {
          try {
            process.kill(lock.pid);
          } catch {
            // Ignore if already exiting
          }
        }
      } catch {
        // Ignore stale lock
      }
      fs.rmSync(lockPath, { force: true });
    }

    const probe = await this.runtime.inspectRuntime();
    if (!probe.ready || !probe.pythonExecutable) {
      this.lastError = 'Isolated Python runtime is missing or uninitialized.';
      return this.getStatus();
    }

    this.intentionallyStopping = false;
    this.lastError = null;
    this.port = await findFreeLoopbackPort(8765);
    this.token = crypto.randomBytes(32).toString('hex');
    this.startedAt = new Date().toISOString();

    const mainPy = path.join(this.aiEngineDir, 'main.py');
    if (!fs.existsSync(mainPy)) {
      this.lastError = `Missing FastAPI entrypoint at ${mainPy}`;
      return this.getStatus();
    }

    const storageRoot = this.storage.getStorageRoot();
    const child = spawn(
      probe.pythonExecutable,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(this.port)],
      {
        cwd: this.aiEngineDir,
        shell: false,
        windowsHide: true,
        env: {
          ...this.runtime.getIsolatedEnvVars(),
          LOCAL_STORAGE_DIR: storageRoot,
          MK_CHECKPOINT_DIR: this.storage.getSubdir('training_runs'),
          MK_WEIGHTS_DIR: this.storage.getSubdir('model_weights'),
          MK_ENGINE_TOKEN: this.token,
        },
      }
    );

    this.proc = child;
    if (child.pid) {
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ pid: child.pid, port: this.port, startedAt: this.startedAt }),
        'utf8'
      );
    }

    child.stdout.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) this.storage.appendLog('ai-engine.log', line.trim());
      }
    });
    child.stderr.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) this.storage.appendLog('ai-engine.log', `[stderr] ${line.trim()}`);
      }
    });

    child.on('exit', (code, signal) => {
      fs.rmSync(lockPath, { force: true });
      this.proc = null;
      if (!this.intentionallyStopping) {
        this.lastError = `Local AI Engine exited unexpectedly (code=${code}, signal=${signal}).`;
        this.storage.appendLog('ai-engine.log', this.lastError);
        if (this.restartCount < 3) {
          this.restartCount += 1;
          setTimeout(() => {
            void this.start().catch(() => {});
          }, 1500);
        }
      }
    });

    // Wait up to 15 seconds for /health to become ready
    for (let i = 0; i < 30; i++) {
      const h = await this.checkHealth();
      if (h.healthy) {
        return this.getStatus();
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    this.lastError = 'Local FastAPI AI Engine timed out before passing health check.';
    return this.getStatus();
  }

  async stop(): Promise<EngineRuntimeStatus> {
    this.intentionallyStopping = true;
    const lockPath = this.getLockFilePath();
    if (this.proc && isProcessAlive(this.proc.pid ?? -1)) {
      const pid = this.proc.pid!;
      this.proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 600));
      if (isProcessAlive(pid)) {
        try {
          this.proc.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
    }
    this.proc = null;
    fs.rmSync(lockPath, { force: true });
    return this.getStatus();
  }

  async restart(): Promise<EngineRuntimeStatus> {
    await this.stop();
    this.restartCount = 0;
    return this.start();
  }

  async requestJson<T = Record<string, unknown>>(
    endpoint: string,
    init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number } = {}
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new Error('Local AI Engine is not running.');
    }
    const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const res = await fetch(`${baseUrl}${cleanPath}`, {
      method: init.method ?? 'GET',
      headers: this.getTokenHeaders(init.body !== undefined),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        typeof (payload as { detail?: string }).detail === 'string'
          ? (payload as { detail: string }).detail
          : `HTTP ${res.status}`;
      throw new Error(detail);
    }
    return payload as T;
  }
}
