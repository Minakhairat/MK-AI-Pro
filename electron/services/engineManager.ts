import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { EngineRuntimeStatus, EngineTokenStatus } from '../../src/types/desktop.ts';
import type { PythonRuntimeManager } from './pythonRuntimeManager.ts';
import { type DesktopStorageManager, resolveConfinedPath } from './storageManager.ts';
import { EngineTokenManager } from './tokenManager.ts';

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
  private tokenManager: EngineTokenManager;
  private aiEngineDir: string;
  private proc: ChildProcess | null = null;
  private port: number | null = null;
  private version: string | null = null;
  private restartCount = 0;
  private startedAt: string | null = null;
  private lastError: string | null = null;
  private intentionallyStopping = false;
  private repairInFlight: Promise<EngineRuntimeStatus> | null = null;

  constructor(params: {
    storage: DesktopStorageManager;
    runtime: PythonRuntimeManager;
    aiEngineDir: string;
    tokenManager?: EngineTokenManager;
  }) {
    this.storage = params.storage;
    this.runtime = params.runtime;
    this.aiEngineDir = path.resolve(params.aiEngineDir);
    this.tokenManager =
      params.tokenManager ??
      new EngineTokenManager({
        userDataRoot: path.dirname(params.storage.getStorageRoot()),
      });
    this.tokenManager.ensureToken();
  }

  private getLockFilePath(): string {
    return resolveConfinedPath(this.storage.getSubdir('temp'), 'mk-engine.lock.json');
  }

  private getTokenHeaders(token: string, includeJson = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  getTokenStatus(): EngineTokenStatus {
    return this.tokenManager.getPublicStatus();
  }

  getBaseUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }

  setPortForTesting(port: number | null): void {
    this.port = port;
  }

  async checkHealth(): Promise<{
    healthy: boolean;
    version: string | null;
    tokenProtected: boolean;
    tokenConfigured: boolean;
    hardware?: Record<string, unknown>;
  }> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      return {
        healthy: false,
        version: null,
        tokenProtected: false,
        tokenConfigured: false,
      };
    }
    const { token } = this.tokenManager.ensureToken();
    try {
      const res = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: this.getTokenHeaders(token, false),
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) {
        return {
          healthy: false,
          version: null,
          tokenProtected: false,
          tokenConfigured: false,
        };
      }
      const data = (await res.json()) as {
        status?: string;
        version?: string;
        token_protected?: boolean;
        token_configured?: boolean;
        hardware?: Record<string, unknown>;
      };
      this.version = data.version ?? this.version;
      const tokenConfigured = data.token_configured !== false && Boolean(data.token_protected);
      if (tokenConfigured) {
        this.tokenManager.markVerified();
      }
      return {
        healthy: data.status === 'online',
        version: data.version ?? null,
        tokenProtected: Boolean(data.token_protected),
        tokenConfigured,
        hardware: data.hardware,
      };
    } catch {
      return {
        healthy: false,
        version: null,
        tokenProtected: false,
        tokenConfigured: false,
      };
    }
  }

  async getStatus(): Promise<EngineRuntimeStatus> {
    const health = await this.checkHealth();
    const alive = Boolean(this.proc && !this.proc.killed && isProcessAlive(this.proc.pid ?? -1));
    const tokenStatus = this.tokenManager.getPublicStatus();
    return {
      running: alive || health.healthy,
      healthy: health.healthy && health.tokenProtected,
      port: this.port,
      pid: this.proc?.pid ?? null,
      version: health.version ?? this.version,
      restartCount: this.restartCount,
      startedAt: this.startedAt,
      lastError: this.lastError,
      tokenProtected: tokenStatus.tokenProtected && (health.healthy ? health.tokenProtected : true),
      bindHost: '127.0.0.1',
      tokenStatus,
    };
  }

  async start(): Promise<EngineRuntimeStatus> {
    if (this.proc && isProcessAlive(this.proc.pid ?? -1)) {
      const existingHealth = await this.checkHealth();
      if (existingHealth.healthy && existingHealth.tokenConfigured) {
        return this.getStatus();
      }
      if (existingHealth.healthy && !existingHealth.tokenConfigured) {
        await this.stop();
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

    const ensured = this.tokenManager.ensureToken();
    if (ensured.repaired) {
      this.storage.appendLog(
        'ai-engine.log',
        `Repaired local engine credential store (fingerprint ${ensured.status.fingerprintSha256Prefix}).`
      );
    }

    this.intentionallyStopping = false;
    this.lastError = null;
    this.port = await findFreeLoopbackPort(8765);
    this.startedAt = new Date().toISOString();

    const mainPy = path.join(this.aiEngineDir, 'main.py');
    if (!fs.existsSync(mainPy)) {
      this.lastError = `Missing FastAPI entrypoint at ${mainPy}`;
      return this.getStatus();
    }

    const storageRoot = this.storage.getStorageRoot();
    const isolatedEnv = { ...this.runtime.getIsolatedEnvVars() };
    delete isolatedEnv.MK_ENGINE_TOKEN;

    const child = spawn(
      probe.pythonExecutable,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(this.port)],
      {
        cwd: this.aiEngineDir,
        shell: false,
        windowsHide: true,
        env: {
          ...isolatedEnv,
          LOCAL_STORAGE_DIR: storageRoot,
          MK_CHECKPOINT_DIR: this.storage.getSubdir('training_runs'),
          MK_WEIGHTS_DIR: this.storage.getSubdir('model_weights'),
          MK_DESKTOP_MODE: '1',
          MK_ENGINE_TOKEN: ensured.token,
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
        if (line.trim()) {
          this.storage.appendLog('ai-engine.log', this.tokenManager.redactSecret(line.trim()));
        }
      }
    });
    child.stderr.on('data', (buf: Buffer) => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) {
          this.storage.appendLog(
            'ai-engine.log',
            `[stderr] ${this.tokenManager.redactSecret(line.trim())}`
          );
        }
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

    // Wait up to 15 seconds for /health and authenticated /capabilities to pass
    for (let i = 0; i < 30; i++) {
      const h = await this.checkHealth();
      if (h.healthy) {
        if (!h.tokenConfigured) {
          this.lastError = 'Local AI Engine started without an active security token; repairing.';
          return this.repairTokenAndRestart('python_engine_missing_token');
        }
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

  async repairTokenAndRestart(reason = 'token_repair'): Promise<EngineRuntimeStatus> {
    if (this.repairInFlight) {
      return this.repairInFlight;
    }
    this.repairInFlight = (async () => {
      const rotated = this.tokenManager.rotateToken(reason);
      this.storage.appendLog(
        'ai-engine.log',
        `Regenerated local engine credential (${reason}; fingerprint ${rotated.status.fingerprintSha256Prefix}). Restarting engine.`
      );
      return this.restart();
    })().finally(() => {
      this.repairInFlight = null;
    });
    return this.repairInFlight;
  }

  async rotateAndSyncToken(): Promise<{
    status: EngineTokenStatus;
    engineSynced: boolean;
    restarted: boolean;
  }> {
    const { previousToken, nextToken, status } = this.tokenManager.rotateToken();
    const baseUrl = this.getBaseUrl();

    if (baseUrl && previousToken) {
      try {
        const res = await fetch(`${baseUrl}/security/rotate-token`, {
          method: 'POST',
          headers: this.getTokenHeaders(previousToken, true),
          body: JSON.stringify({ new_token: nextToken }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          // Verify new token works immediately on authenticated /capabilities
          const verifyRes = await fetch(`${baseUrl}/capabilities`, {
            method: 'GET',
            headers: this.getTokenHeaders(nextToken, false),
            signal: AbortSignal.timeout(5000),
          });
          if (verifyRes.ok) {
            this.tokenManager.markVerified();
            this.storage.appendLog(
              'ai-engine.log',
              `Rotated and live-synchronized engine security token (${this.tokenManager.getPublicStatus().fingerprintSha256Prefix}).`
            );
            return {
              status: this.tokenManager.getPublicStatus(),
              engineSynced: true,
              restarted: false,
            };
          }
        }
      } catch {
        // Fall through to clean restart with new token
      }
    }

    // Fallback or cold engine: restart engine cleanly with the newly persisted token
    if (this.proc && isProcessAlive(this.proc.pid ?? -1)) {
      const restartedStatus = await this.restart();
      return {
        status: restartedStatus.tokenStatus ?? status,
        engineSynced: restartedStatus.healthy,
        restarted: true,
      };
    }

    return {
      status,
      engineSynced: false,
      restarted: false,
    };
  }

  async requestJson<T = Record<string, unknown>>(
    endpoint: string,
    init: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number; retryOnAuth?: boolean } = {}
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new Error('Local AI Engine is not running.');
    }
    const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const { token } = this.tokenManager.ensureToken();
    const res = await fetch(`${baseUrl}${cleanPath}`, {
      method: init.method ?? 'GET',
      headers: this.getTokenHeaders(token, init.body !== undefined),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    });

    if ((res.status === 401 || res.status === 503) && init.retryOnAuth !== false) {
      const errPayload = (await res.json().catch(() => ({}))) as { detail?: string };
      const detailStr = String(errPayload.detail || '').toLowerCase();
      if (res.status === 401 || detailStr.includes('token')) {
        const repairedStatus = await this.repairTokenAndRestart('rejected_or_missing_engine_token');
        if (repairedStatus.healthy) {
          return this.requestJson<T>(endpoint, { ...init, retryOnAuth: false });
        }
      }
      throw new Error(errPayload.detail || `HTTP ${res.status}`);
    }

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
