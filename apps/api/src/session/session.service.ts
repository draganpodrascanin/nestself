/**
 * Session service: create, read, refresh, regenerate, destroy web sessions.
 *
 * @see 3.6 Sessions, D-06, SESS-R-09..21
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import {
  sessionKey,
  userSessionsKey,
  sessionLockKey,
  principalKey,
  INVALIDATE_CHANNEL,
  SESSION_LOCK_TTL,
} from '../redis/redis-keys.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityProviderService } from '../identity/identity-provider.service.js';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { TokenCipher } from './token-cipher.js';
import { resolveLifetimes } from './session-policy.js';
import type {
  SessionRecord,
  CreateSessionInput,
  CognitoSession,
} from './session.types.js';
import {
  hashSessionId,
  hashIp,
  parseUserAgent,
  generateSessionId,
  generateCsrfToken,
  ACTIVITY_TOUCH_INTERVAL,
  REFRESH_THRESHOLD,
  STALE_TOKEN_GRACE,
  LOCK_WAIT_MS,
} from './session-helpers.js';
import {
  SessionExpiredError,
  SessionRefreshBusyError,
} from '../common/api-error.js';
import type { Population, ActiveContext } from '@nestself/contracts';

/** Session listing display item (SESS-R-17). */
export interface SessionListItem {
  sessionIdHash: string;
  surface: 'workspace' | 'admin';
  createdAt: string;
  lastActivityAt: string;
  ipHash: string;
  userAgentFamily: string;
  isCurrent: boolean;
}

/** Stored record omits sessionId (raw id never persisted in Redis; 3.6.1). */
type StoredRecord = Omit<SessionRecord, 'sessionId'>;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly overridesJson: string | undefined;

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    private readonly idp: IdentityProviderService,
    private readonly cipher: TokenCipher,
    config: ConfigService,
  ) {
    this.overridesJson = config.get<string>('SESSION_LIFETIME_OVERRIDES');
  }

  /** @see SESS-R-09, SESS-R-10 */
  async create(
    input: CreateSessionInput,
  ): Promise<{ sessionId: string; csrfToken: string; absoluteExpiresAt: Date }> {
    const sessionId = generateSessionId();
    const csrfToken = generateCsrfToken();
    const hash = hashSessionId(sessionId);
    const now = new Date();
    const lifetimes = resolveLifetimes(
      input.population, input.context, input.rememberDevice, this.overridesJson,
    );
    const absoluteExpiresAt = new Date(now.getTime() + lifetimes.absoluteSeconds * 1_000);
    const idleExpiresAt = new Date(now.getTime() + lifetimes.idleSeconds * 1_000);
    const accessExpiresAt = new Date(now.getTime() + input.tokens.expiresIn * 1_000);

    const stored: StoredRecord = {
      userId: input.userId, surface: input.surface,
      population: input.population, context: input.context,
      // Ruling D: set lastPersonalOrgId at session creation when the
      // initial context is personal with an orgId.
      ...(input.context.kind === 'personal' && input.context.orgId
        ? { lastPersonalOrgId: input.context.orgId }
        : {}),
      cognito: {
        username: input.cognitoUsername,
        accessToken: this.cipher.encrypt(input.tokens.accessToken),
        idToken: this.cipher.encrypt(input.tokens.idToken),
        refreshToken: this.cipher.encrypt(input.tokens.refreshToken),
        accessExpiresAt: accessExpiresAt.toISOString(),
      },
      auth: input.auth, lastStepUpAt: null,
      createdAt: now.toISOString(), lastActivityAt: now.toISOString(),
      idleExpiresAt: idleExpiresAt.toISOString(),
      absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      rememberDevice: input.rememberDevice,
      ipHash: input.ip ? hashIp(input.ip) : '',
      userAgentFamily: parseUserAgent(input.userAgent),
      csrfToken,
    };

    await this.store.set(sessionKey(hash), JSON.stringify(stored), {
      ttlSeconds: lifetimes.absoluteSeconds,
    });
    await this.store.sAdd(userSessionsKey(input.userId), hash);
    return { sessionId, csrfToken, absoluteExpiresAt };
  }

  /** Read and validate a session. Touches activity at most once per 60 s. */
  async get(sessionId: string): Promise<SessionRecord | null> {
    const hash = hashSessionId(sessionId);
    const raw = await this.store.get(sessionKey(hash));
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredRecord;
    const now = Date.now();
    if (now >= new Date(stored.absoluteExpiresAt).getTime()) {
      await this.destroyByHash(hash, stored);
      return null;
    }
    if (now >= new Date(stored.idleExpiresAt).getTime()) {
      await this.destroyByHash(hash, stored);
      return null;
    }

    const lastActivity = new Date(stored.lastActivityAt).getTime();
    if (now - lastActivity >= ACTIVITY_TOUCH_INTERVAL * 1_000) {
      const lifetimes = resolveLifetimes(
        stored.population, stored.context, stored.rememberDevice, this.overridesJson,
      );
      const newIdle = new Date(now + lifetimes.idleSeconds * 1_000);
      const absMs = new Date(stored.absoluteExpiresAt).getTime();
      stored.lastActivityAt = new Date(now).toISOString();
      stored.idleExpiresAt = new Date(Math.min(newIdle.getTime(), absMs)).toISOString();
      // Re-encrypt tokens if they were decrypted with the previous key (Fix 2: key rotation)
      this.reEncryptIfNeeded(stored);
      const remaining = Math.max(1, Math.floor((absMs - now) / 1_000));
      await this.store.set(sessionKey(hash), JSON.stringify(stored), { ttlSeconds: remaining });
    }
    return this.decryptRecord(stored, sessionId);
  }

  /**
   * New session id and a new CSRF token for the same record (sign-in and
   * step-up). Callers must set both cookies again. @see SESS-R-10
   */
  async regenerate(sessionId: string): Promise<{ sessionId: string; csrfToken: string }> {
    const oldHash = hashSessionId(sessionId);
    const raw = await this.store.get(sessionKey(oldHash));
    if (!raw) throw new SessionExpiredError();
    const stored = JSON.parse(raw) as StoredRecord;
    const newId = generateSessionId();
    const newHash = hashSessionId(newId);
    // Re-encrypt on regenerate if needed
    this.reEncryptIfNeeded(stored);
    stored.csrfToken = generateCsrfToken();
    const remaining = Math.max(
      1, Math.floor((new Date(stored.absoluteExpiresAt).getTime() - Date.now()) / 1_000),
    );
    await this.store.set(sessionKey(newHash), JSON.stringify(stored), { ttlSeconds: remaining });
    await this.store.del(sessionKey(oldHash));
    await this.store.sRem(userSessionsKey(stored.userId), oldHash);
    await this.store.sAdd(userSessionsKey(stored.userId), newHash);
    return { sessionId: newId, csrfToken: stored.csrfToken };
  }

  /** Update context; recompute lifetimes but never extend absoluteExpiresAt. */
  async updateContext(sessionId: string, context: ActiveContext, population: Population): Promise<void> {
    const hash = hashSessionId(sessionId);
    const raw = await this.store.get(sessionKey(hash));
    if (!raw) throw new SessionExpiredError();
    const stored = JSON.parse(raw) as StoredRecord;
    const lifetimes = resolveLifetimes(population, context, stored.rememberDevice, this.overridesJson);
    const now = Date.now();
    const absMs = new Date(stored.absoluteExpiresAt).getTime();
    stored.context = context;
    stored.population = population;
    // ACC-R-12: track the last orgId used in personal context for sticky resolution.
    if (context.kind === 'personal' && context.orgId) {
      stored.lastPersonalOrgId = context.orgId;
    }
    stored.idleExpiresAt = new Date(Math.min(now + lifetimes.idleSeconds * 1_000, absMs)).toISOString();
    stored.lastActivityAt = new Date(now).toISOString();
    this.reEncryptIfNeeded(stored);
    const remaining = Math.max(1, Math.floor((absMs - now) / 1_000));
    await this.store.set(sessionKey(hash), JSON.stringify(stored), { ttlSeconds: remaining });
  }

  /** @see SESS-R-18 */
  async markStepUp(sessionId: string, at: Date): Promise<void> {
    const hash = hashSessionId(sessionId);
    const raw = await this.store.get(sessionKey(hash));
    if (!raw) throw new SessionExpiredError();
    const stored = JSON.parse(raw) as StoredRecord;
    stored.lastStepUpAt = at.toISOString();
    this.reEncryptIfNeeded(stored);
    const remaining = Math.max(
      1, Math.floor((new Date(stored.absoluteExpiresAt).getTime() - Date.now()) / 1_000),
    );
    await this.store.set(sessionKey(hash), JSON.stringify(stored), { ttlSeconds: remaining });
  }

  /** @see 3.6.6 Revocation paths */
  async destroy(sessionId: string, opts?: { revokeTokens?: boolean }): Promise<void> {
    const hash = hashSessionId(sessionId);
    const raw = await this.store.get(sessionKey(hash));
    if (!raw) return;
    await this.destroyByHash(hash, JSON.parse(raw) as StoredRecord, opts);
  }

  /**
   * Destroy one of the user's sessions by its hash (the id the session list
   * exposes). Revokes the refresh token and publishes the invalidation like
   * every other destroy path. Returns false when the hash is not one of the
   * user's sessions. @see SESS-R-17
   */
  async destroyOwnedByHash(userId: string, hash: string): Promise<boolean> {
    const raw = await this.store.get(sessionKey(hash));
    if (!raw) return false;
    const stored = JSON.parse(raw) as StoredRecord;
    if (stored.userId !== userId) return false;
    await this.destroyByHash(hash, stored, { revokeTokens: true });
    return true;
  }

  /** @see SESS-R-15 */
  async destroyAllForUser(
    userId: string, opts?: { orgId?: string; exceptSessionId?: string },
  ): Promise<void> {
    const hashes = await this.store.sMembers(userSessionsKey(userId));
    const exceptHash = opts?.exceptSessionId ? hashSessionId(opts.exceptSessionId) : null;
    for (const hash of hashes) {
      if (hash === exceptHash) continue;
      const raw = await this.store.get(sessionKey(hash));
      if (!raw) { await this.store.sRem(userSessionsKey(userId), hash); continue; }
      const stored = JSON.parse(raw) as StoredRecord;
      if (opts?.orgId) {
        // Destroy sessions in any context tied to this org: organization,
        // personal-with-orgId, or (future) any context variant with orgId.
        const ctxOrgId =
          (stored.context.kind === 'organization' || stored.context.kind === 'personal')
            ? stored.context.orgId
            : undefined;
        if (ctxOrgId !== opts.orgId) continue;
      }
      await this.destroyByHash(hash, stored, { revokeTokens: true });
    }
  }

  /** @see SESS-R-17 */
  async listForUser(userId: string, currentSessionId: string | null): Promise<SessionListItem[]> {
    const hashes = await this.store.sMembers(userSessionsKey(userId));
    const currentHash = currentSessionId ? hashSessionId(currentSessionId) : null;
    const items: SessionListItem[] = [];
    for (const hash of hashes) {
      const raw = await this.store.get(sessionKey(hash));
      if (!raw) { await this.store.sRem(userSessionsKey(userId), hash); continue; }
      const r = JSON.parse(raw) as StoredRecord;
      items.push({
        sessionIdHash: hash, surface: r.surface, createdAt: r.createdAt,
        lastActivityAt: r.lastActivityAt, ipHash: r.ipHash,
        userAgentFamily: r.userAgentFamily, isCurrent: hash === currentHash,
      });
    }
    return items;
  }

  /** @see SESS-R-14, 3.6.5 Renewal */
  async ensureFreshAccessToken(record: SessionRecord): Promise<SessionRecord> {
    const expiresAt = new Date(record.cognito.accessExpiresAt).getTime();
    if (expiresAt - Date.now() >= REFRESH_THRESHOLD * 1_000) return record;

    const hash = hashSessionId(record.sessionId);
    const lockKey = sessionLockKey(hash);
    const acquired = await this.store.set(lockKey, '1', {
      ttlSeconds: SESSION_LOCK_TTL, onlyIfAbsent: true,
    });
    if (!acquired) return this.waitForLockOrFallback(record, lockKey);

    try {
      const freshRaw = await this.store.get(sessionKey(hash));
      if (!freshRaw) throw new SessionExpiredError();
      const fresh = JSON.parse(freshRaw) as StoredRecord;
      if (new Date(fresh.cognito.accessExpiresAt).getTime() - Date.now() >= REFRESH_THRESHOLD * 1_000) {
        return this.decryptRecord(fresh, record.sessionId);
      }
      const decrypted = this.decryptRecord(fresh, record.sessionId);
      const tokens = await this.idp.refresh({
        refreshToken: decrypted.cognito.refreshToken, username: decrypted.cognito.username,
      });
      fresh.cognito = {
        username: fresh.cognito.username,
        accessToken: this.cipher.encrypt(tokens.accessToken),
        idToken: this.cipher.encrypt(tokens.idToken),
        refreshToken: tokens.refreshToken
          ? this.cipher.encrypt(tokens.refreshToken)
          : fresh.cognito.refreshToken,
        accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1_000).toISOString(),
      };
      const remaining = Math.max(
        1, Math.floor((new Date(fresh.absoluteExpiresAt).getTime() - Date.now()) / 1_000),
      );
      await this.store.set(sessionKey(hash), JSON.stringify(fresh), { ttlSeconds: remaining });
      return this.decryptRecord(fresh, record.sessionId);
    } catch (err) {
      if (err instanceof IdentityProviderError) {
        if (['not_authorized', 'user_not_found', 'user_disabled'].includes(err.code)) {
          // Fix 7: attempt revoke before destroying (3.6.5), ignore errors.
          // record.cognito.refreshToken is already plaintext (from get/decryptRecord).
          try {
            await this.idp.revokeRefreshToken(record.cognito.refreshToken);
          } catch { /* best effort */ }
          await this.destroyByHash(hash, record, { revokeTokens: false });
          throw new SessionExpiredError('Refresh token revoked or user disabled');
        }
      }
      throw err;
    } finally {
      await this.store.del(lockKey);
    }
  }

  private async waitForLockOrFallback(record: SessionRecord, lockKey: string): Promise<SessionRecord> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const exists = await this.store.get(lockKey);
      if (!exists) {
        const hash = hashSessionId(record.sessionId);
        const raw = await this.store.get(sessionKey(hash));
        if (!raw) throw new SessionExpiredError();
        return this.decryptRecord(JSON.parse(raw) as StoredRecord, record.sessionId);
      }
    }
    if (new Date(record.cognito.accessExpiresAt).getTime() - Date.now() > STALE_TOKEN_GRACE * 1_000) {
      return record;
    }
    throw new SessionRefreshBusyError();
  }

  private async destroyByHash(
    hash: string, stored: StoredRecord, opts?: { revokeTokens?: boolean },
  ): Promise<void> {
    await this.store.del(sessionKey(hash));
    await this.store.sRem(userSessionsKey(stored.userId), hash);
    if (opts?.revokeTokens !== false) {
      try {
        const { plaintext: refreshToken } = this.cipher.decrypt(stored.cognito.refreshToken);
        await this.idp.revokeRefreshToken(refreshToken);
      } catch (err) {
        this.logger.warn(err, 'Failed to revoke refresh token during session destroy');
      }
    }
    const msg = JSON.stringify({
      keys: [principalKey(stored.userId)], reason: 'session_destroyed',
      userId: stored.userId, sessionIdHash: hash,
    });
    await this.store.publish(INVALIDATE_CHANNEL, msg);
  }

  /**
   * Re-encrypt tokens with the current key if any was decrypted with the previous key.
   * @see Appendix E.1, 10.6 Key and secret rotation
   */
  private reEncryptIfNeeded(stored: StoredRecord): void {
    const a = this.cipher.decrypt(stored.cognito.accessToken);
    const i = this.cipher.decrypt(stored.cognito.idToken);
    const r = this.cipher.decrypt(stored.cognito.refreshToken);
    if (a.usedPreviousKey || i.usedPreviousKey || r.usedPreviousKey) {
      stored.cognito.accessToken = this.cipher.encrypt(a.plaintext);
      stored.cognito.idToken = this.cipher.encrypt(i.plaintext);
      stored.cognito.refreshToken = this.cipher.encrypt(r.plaintext);
    }
  }

  private decryptRecord(stored: StoredRecord, sessionId: string): SessionRecord {
    const cognito: CognitoSession = {
      username: stored.cognito.username,
      accessToken: this.cipher.decrypt(stored.cognito.accessToken).plaintext,
      idToken: this.cipher.decrypt(stored.cognito.idToken).plaintext,
      refreshToken: this.cipher.decrypt(stored.cognito.refreshToken).plaintext,
      accessExpiresAt: stored.cognito.accessExpiresAt,
    };
    return { ...stored, sessionId, cognito };
  }
}
