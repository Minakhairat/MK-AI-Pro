import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EngineTokenStatus } from '../../src/types/desktop.ts';
import { resolveConfinedPath } from './storageManager.ts';

export interface SecretProtectionBackend {
  readonly mode: 'os_dpapi_keychain' | 'restricted_local_store';
  isAvailable(): boolean;
  protect(plaintext: string): Buffer;
  unprotect(cipher: Buffer): string;
}

interface StoredCredentialEnvelope {
  version: 1;
  protectionMode: 'os_dpapi_keychain' | 'restricted_local_store';
  encryptedPayloadBase64: string;
  ivBase64?: string;
  authTagBase64?: string;
  saltHex?: string;
  createdAt: string;
  rotatedAt: string | null;
  lastVerifiedAt: string | null;
  lastRepairReason: string | null;
  repairCount: number;
}

export function isValidEngineToken(token: string | null | undefined): token is string {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (trimmed.length < 32 || trimmed.length > 256) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return false;
  // Reject degenerate single-character repeated strings
  if (new Set(trimmed).size < 8) return false;
  return true;
}

export function computeTokenFingerprint(token: string): string {
  return `sha256:${crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 8)}`;
}

export function createElectronSafeStorageBackend(safeStorageApi?: {
  isEncryptionAvailable?: () => boolean;
  encryptString?: (plain: string) => Buffer;
  decryptString?: (encrypted: Buffer) => string;
}): SecretProtectionBackend {
  if (
    safeStorageApi &&
    typeof safeStorageApi.isEncryptionAvailable === 'function' &&
    safeStorageApi.isEncryptionAvailable() &&
    typeof safeStorageApi.encryptString === 'function' &&
    typeof safeStorageApi.decryptString === 'function'
  ) {
    return {
      mode: 'os_dpapi_keychain',
      isAvailable: () => true,
      protect: (plaintext: string) => safeStorageApi.encryptString!(plaintext),
      unprotect: (cipher: Buffer) => safeStorageApi.decryptString!(cipher),
    };
  }

  // Fallback for environments where OS keychain encryption is unavailable (e.g. headless Linux / CLI test runner)
  return {
    mode: 'restricted_local_store',
    isAvailable: () => false,
    protect: (plaintext: string) => Buffer.from(plaintext, 'utf8'),
    unprotect: (cipher: Buffer) => cipher.toString('utf8'),
  };
}

export class EngineTokenManager {
  private securityDir: string;
  private credentialPath: string;
  private backend: SecretProtectionBackend;
  private activeToken: string | null = null;
  private sessionSeenTokens = new Set<string>();
  private metadata: Omit<StoredCredentialEnvelope, 'version' | 'encryptedPayloadBase64' | 'ivBase64' | 'authTagBase64' | 'saltHex'> = {
    protectionMode: 'restricted_local_store',
    createdAt: new Date().toISOString(),
    rotatedAt: null,
    lastVerifiedAt: null,
    lastRepairReason: null,
    repairCount: 0,
  };

  constructor(params: { userDataRoot: string; backend?: SecretProtectionBackend }) {
    this.securityDir = resolveConfinedPath(path.resolve(params.userDataRoot), 'security');
    this.credentialPath = resolveConfinedPath(this.securityDir, 'mk-engine-credential.dat');
    this.backend = params.backend ?? createElectronSafeStorageBackend();
    this.metadata.protectionMode = this.backend.mode;
    fs.mkdirSync(this.securityDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.securityDir, 0o700);
    } catch {
      // Ignore chmod restriction on Windows NTFS
    }
  }

  private deriveLocalWrappingKey(saltHex: string): Buffer {
    const context = `${os.hostname()}|${os.userInfo().username}|${this.securityDir}`;
    return crypto.scryptSync(context, saltHex, 32);
  }

  private writeEnvelope(token: string, meta: typeof this.metadata): void {
    fs.mkdirSync(this.securityDir, { recursive: true, mode: 0o700 });

    let envelope: StoredCredentialEnvelope;
    if (this.backend.mode === 'os_dpapi_keychain') {
      const cipher = this.backend.protect(token);
      envelope = {
        version: 1,
        protectionMode: 'os_dpapi_keychain',
        encryptedPayloadBase64: cipher.toString('base64'),
        createdAt: meta.createdAt,
        rotatedAt: meta.rotatedAt,
        lastVerifiedAt: meta.lastVerifiedAt,
        lastRepairReason: meta.lastRepairReason,
        repairCount: meta.repairCount,
      };
    } else {
      const saltHex = crypto.randomBytes(16).toString('hex');
      const iv = crypto.randomBytes(12);
      const key = this.deriveLocalWrappingKey(saltHex);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      envelope = {
        version: 1,
        protectionMode: 'restricted_local_store',
        encryptedPayloadBase64: encrypted.toString('base64'),
        ivBase64: iv.toString('base64'),
        authTagBase64: authTag.toString('base64'),
        saltHex,
        createdAt: meta.createdAt,
        rotatedAt: meta.rotatedAt,
        lastVerifiedAt: meta.lastVerifiedAt,
        lastRepairReason: meta.lastRepairReason,
        repairCount: meta.repairCount,
      };
    }

    const tmpPath = `${this.credentialPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, this.credentialPath);
    try {
      fs.chmodSync(this.credentialPath, 0o600);
    } catch {
      // Ignore chmod restriction on Windows NTFS
    }
    this.activeToken = token;
    this.sessionSeenTokens.add(token);
    this.metadata = { ...meta };
  }

  private readAndDecryptEnvelope(): { token: string; envelope: StoredCredentialEnvelope } | null {
    if (!fs.existsSync(this.credentialPath)) return null;
    try {
      const raw = fs.readFileSync(this.credentialPath, 'utf8');
      const env = JSON.parse(raw) as StoredCredentialEnvelope;
      if (env.version !== 1 || typeof env.encryptedPayloadBase64 !== 'string') {
        return null;
      }

      let decrypted = '';
      if (env.protectionMode === 'os_dpapi_keychain') {
        if (this.backend.mode !== 'os_dpapi_keychain') return null;
        decrypted = this.backend.unprotect(Buffer.from(env.encryptedPayloadBase64, 'base64'));
      } else {
        if (!env.saltHex || !env.ivBase64 || !env.authTagBase64) return null;
        const key = this.deriveLocalWrappingKey(env.saltHex);
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(env.ivBase64, 'base64')
        );
        decipher.setAuthTag(Buffer.from(env.authTagBase64, 'base64'));
        decrypted = Buffer.concat([
          decipher.update(Buffer.from(env.encryptedPayloadBase64, 'base64')),
          decipher.final(),
        ]).toString('utf8');
      }

      if (!isValidEngineToken(decrypted)) return null;
      return { token: decrypted, envelope: env };
    } catch {
      return null;
    }
  }

  generateSecureToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  ensureToken(): { token: string; status: EngineTokenStatus; repaired: boolean; created: boolean } {
    if (isValidEngineToken(this.activeToken)) {
      return {
        token: this.activeToken,
        status: this.getPublicStatus(),
        repaired: false,
        created: false,
      };
    }

    const fileExisted = fs.existsSync(this.credentialPath);
    const loaded = this.readAndDecryptEnvelope();
    if (loaded) {
      this.activeToken = loaded.token;
      this.sessionSeenTokens.add(loaded.token);
      this.metadata = {
        protectionMode: loaded.envelope.protectionMode,
        createdAt: loaded.envelope.createdAt || new Date().toISOString(),
        rotatedAt: loaded.envelope.rotatedAt ?? null,
        lastVerifiedAt: loaded.envelope.lastVerifiedAt ?? null,
        lastRepairReason: loaded.envelope.lastRepairReason ?? null,
        repairCount: loaded.envelope.repairCount ?? 0,
      };
      return {
        token: loaded.token,
        status: this.getPublicStatus(),
        repaired: false,
        created: false,
      };
    }

    // Generate or automatically repair missing/corrupted credential
    const freshToken = this.generateSecureToken();
    const now = new Date().toISOString();
    const meta: typeof this.metadata = {
      protectionMode: this.backend.mode,
      createdAt: now,
      rotatedAt: fileExisted ? now : null,
      lastVerifiedAt: null,
      lastRepairReason: fileExisted ? 'corrupted_or_unreadable_credential_repaired' : null,
      repairCount: fileExisted ? 1 : 0,
    };
    this.writeEnvelope(freshToken, meta);
    return {
      token: freshToken,
      status: this.getPublicStatus(),
      repaired: fileExisted,
      created: !fileExisted,
    };
  }

  rotateToken(repairReason?: string): {
    previousToken: string | null;
    nextToken: string;
    status: EngineTokenStatus;
  } {
    const previousToken = isValidEngineToken(this.activeToken)
      ? this.activeToken
      : this.readAndDecryptEnvelope()?.token ?? null;
    if (previousToken) {
      this.sessionSeenTokens.add(previousToken);
    }

    const nextToken = this.generateSecureToken();
    const now = new Date().toISOString();
    const nextMeta: typeof this.metadata = {
      protectionMode: this.backend.mode,
      createdAt: this.metadata.createdAt || now,
      rotatedAt: now,
      lastVerifiedAt: null,
      lastRepairReason: repairReason ?? this.metadata.lastRepairReason,
      repairCount: repairReason ? this.metadata.repairCount + 1 : this.metadata.repairCount,
    };
    this.writeEnvelope(nextToken, nextMeta);

    return {
      previousToken,
      nextToken,
      status: this.getPublicStatus(),
    };
  }

  markVerified(): void {
    if (!isValidEngineToken(this.activeToken)) return;
    const now = new Date().toISOString();
    this.writeEnvelope(this.activeToken, {
      ...this.metadata,
      lastVerifiedAt: now,
    });
  }

  getPublicStatus(): EngineTokenStatus {
    const valid = isValidEngineToken(this.activeToken);
    return {
      configured: valid,
      tokenProtected: valid,
      protectionMode: this.metadata.protectionMode,
      fingerprintSha256Prefix: valid ? computeTokenFingerprint(this.activeToken!) : 'unconfigured',
      createdAt: valid ? this.metadata.createdAt : null,
      rotatedAt: this.metadata.rotatedAt,
      lastVerifiedAt: this.metadata.lastVerifiedAt,
      lastRepairReason: this.metadata.lastRepairReason,
      repairCount: this.metadata.repairCount,
    };
  }

  redactSecret(text: string): string {
    let scrubbed = text
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_ENGINE_TOKEN]')
      .replace(/MK_ENGINE_TOKEN=[^\s"']+/gi, 'MK_ENGINE_TOKEN=[REDACTED_ENGINE_TOKEN]');
    for (const secret of this.sessionSeenTokens) {
      if (secret && secret.length >= 16) {
        scrubbed = scrubbed.split(secret).join('[REDACTED_ENGINE_TOKEN]');
      }
    }
    return scrubbed;
  }
}
