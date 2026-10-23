/**
 * Unit tests for SessionService with MemoryKeyValueStore and mocked deps.
 *
 * @see SESS-R-09..21
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionService } from './session.service.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { type IdentityProviderService } from '../identity/identity-provider.service.js';
import { IdentityProviderError } from '../identity/identity-provider.service.js';
import { type TokenCipher } from './token-cipher.js';
import { type ConfigService } from '@nestjs/config';
import type { CreateSessionInput } from './session.types.js';
import { sessionKey, INVALIDATE_CHANNEL } from '../redis/redis-keys.js';
import { createHash } from 'node:crypto';

// --- mocks ---

function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

const mockCipher = {
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => ({
    plaintext: v.startsWith('enc:') ? v.slice(4) : v,
    usedPreviousKey: false,
  }),
} as unknown as TokenCipher;

function makeMockIdp() {
  return {
    refresh: vi.fn().mockResolvedValue({
      accessToken: 'new-access',
      idToken: 'new-id',
      refreshToken: 'new-refresh',
      expiresIn: 900,
    }),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    globalSignOut: vi.fn().mockResolvedValue(undefined),
  } as unknown as IdentityProviderService;
}

const baseInput: CreateSessionInput = {
  userId: 'user_1',
  surface: 'workspace',
  population: 'employee',
  context: { kind: 'personal' },
  cognitoUsername: 'cog_user',
  tokens: {
    accessToken: 'access-tok',
    idToken: 'id-tok',
    refreshToken: 'refresh-tok',
    expiresIn: 900,
  },
  auth: { method: 'email_otp', time: new Date().toISOString(), secondFactor: false },
  rememberDevice: false,
  ip: '192.168.1.1',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
};

function makeConfig(): ConfigService {
  return { get: () => undefined } as unknown as ConfigService;
}

describe('SessionService', () => {
  let store: MemoryKeyValueStore;
  let idp: ReturnType<typeof makeMockIdp>;
  let service: SessionService;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-06-01T12:00:00Z') });
    store = new MemoryKeyValueStore();
    idp = makeMockIdp();
    service = new SessionService(store, idp as unknown as IdentityProviderService, mockCipher, makeConfig());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('create returns sessionId and csrfToken', async () => {
    const result = await service.create(baseInput);
    expect(result.sessionId).toBeTruthy();
    expect(result.csrfToken).toBeTruthy();
    expect(result.absoluteExpiresAt).toBeInstanceOf(Date);
  });

  it('get returns the created session', async () => {
    const { sessionId } = await service.create(baseInput);
    const record = await service.get(sessionId);
    expect(record).not.toBeNull();
    expect(record!.userId).toBe('user_1');
    expect(record!.cognito.accessToken).toBe('access-tok');
  });

  it('destroyOwnedByHash destroys only the owner\'s session and revokes its refresh token', async () => {
    const a = await service.create(baseInput);
    const b = await service.create(baseInput);
    const listed = await service.listForUser('user_1', a.sessionId);
    const other = listed.find((s) => !s.isCurrent)!;

    expect(await service.destroyOwnedByHash('someone_else', other.sessionIdHash)).toBe(false);
    expect(await service.get(b.sessionId)).not.toBeNull();

    expect(await service.destroyOwnedByHash('user_1', other.sessionIdHash)).toBe(true);
    expect(await service.get(b.sessionId)).toBeNull();
    expect(await service.get(a.sessionId)).not.toBeNull();
    expect(idp.revokeRefreshToken).toHaveBeenCalled();
    expect(await service.destroyOwnedByHash('user_1', other.sessionIdHash)).toBe(false);
  });

  it('get returns null for unknown session', async () => {
    const result = await service.get('nonexistent');
    expect(result).toBeNull();
  });

  it('idle expiry: get returns null after idle timeout', async () => {
    const { sessionId } = await service.create(baseInput);
    // Employee personal idle = 30 min = 1800s
    vi.advanceTimersByTime(1801 * 1000);
    const result = await service.get(sessionId);
    expect(result).toBeNull();
  });

  it('absolute expiry: get returns null after absolute timeout', async () => {
    const { sessionId } = await service.create(baseInput);
    // Employee personal absolute = 12h = 43200s; keep refreshing idle
    for (let i = 0; i < 26; i++) {
      vi.advanceTimersByTime(1700 * 1000); // just under 30 min idle
      await service.get(sessionId);
    }
    // Now should be past 12h
    const result = await service.get(sessionId);
    expect(result).toBeNull();
  });

  it('regenerate produces a new id and invalidates the old', async () => {
    const { sessionId } = await service.create(baseInput);
    const before = await service.get(sessionId);
    const { sessionId: newId, csrfToken } = await service.regenerate(sessionId);
    expect(newId).not.toBe(sessionId);
    expect(csrfToken).not.toBe(before!.csrfToken);

    const oldResult = await service.get(sessionId);
    expect(oldResult).toBeNull();

    const newResult = await service.get(newId);
    expect(newResult).not.toBeNull();
    expect(newResult!.sessionId).toBe(newId);
  });

  it('updateContext recomputes lifetimes but never extends absoluteExpiresAt', async () => {
    const { sessionId, absoluteExpiresAt } = await service.create(baseInput);

    await service.updateContext(
      sessionId,
      { kind: 'organization', orgId: 'org_1' },
      'employee',
    );

    const record = await service.get(sessionId);
    expect(record).not.toBeNull();
    expect(record!.context).toEqual({ kind: 'organization', orgId: 'org_1' });
    // Absolute should not have extended
    const hash = hashId(sessionId);
    const raw = JSON.parse((await store.get(sessionKey(hash)))!);
    expect(new Date(raw.absoluteExpiresAt).getTime()).toBeLessThanOrEqual(
      absoluteExpiresAt.getTime(),
    );
  });

  it('destroy removes the session and publishes invalidate', async () => {
    const messages: string[] = [];
    await store.subscribe(INVALIDATE_CHANNEL, (m) => messages.push(m));

    const { sessionId } = await service.create(baseInput);
    await service.destroy(sessionId, { revokeTokens: true });

    const result = await service.get(sessionId);
    expect(result).toBeNull();
    expect(idp.revokeRefreshToken).toHaveBeenCalled();
    expect(messages.length).toBeGreaterThan(0);
    const msg = JSON.parse(messages[0]!);
    expect(msg.reason).toBe('session_destroyed');
    expect(msg.userId).toBe('user_1');
  });

  it('destroyAllForUser with orgId filter', async () => {
    const personalSession = await service.create(baseInput);
    const orgInput = {
      ...baseInput,
      context: { kind: 'organization' as const, orgId: 'org_1' },
    };
    const orgSession = await service.create(orgInput);

    await service.destroyAllForUser('user_1', { orgId: 'org_1' });

    // Personal session should still exist
    const personal = await service.get(personalSession.sessionId);
    expect(personal).not.toBeNull();

    // Org session should be destroyed
    const org = await service.get(orgSession.sessionId);
    expect(org).toBeNull();
  });

  it('listForUser returns display fields only', async () => {
    const { sessionId } = await service.create(baseInput);
    const list = await service.listForUser('user_1', sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]!.isCurrent).toBe(true);
    expect(list[0]!.surface).toBe('workspace');
    // Should NOT contain tokens or csrf
    const item = list[0]!;
    expect(item).not.toHaveProperty('cognito');
    expect(item).not.toHaveProperty('csrfToken');
  });

  it('ensureFreshAccessToken refreshes when token is near expiry', async () => {
    const { sessionId } = await service.create(baseInput);
    // Advance to just before access token expiry (900s - 120s threshold)
    vi.advanceTimersByTime(800 * 1000);
    const record = await service.get(sessionId);
    expect(record).not.toBeNull();

    const refreshed = await service.ensureFreshAccessToken(record!);
    expect(idp.refresh).toHaveBeenCalled();
    expect(refreshed.cognito.accessToken).toBe('new-access');
  });

  it('ensureFreshAccessToken skips refresh when token is fresh', async () => {
    const { sessionId } = await service.create(baseInput);
    const record = await service.get(sessionId);
    expect(record).not.toBeNull();

    const same = await service.ensureFreshAccessToken(record!);
    expect(idp.refresh).not.toHaveBeenCalled();
    expect(same.cognito.accessToken).toBe('access-tok');
  });

  it('failed refresh with not_authorized revokes token then destroys the session', async () => {
    const { sessionId } = await service.create(baseInput);
    vi.advanceTimersByTime(800 * 1000);
    const record = await service.get(sessionId);
    expect(record).not.toBeNull();

    const err = new IdentityProviderError('Refresh revoked', 'not_authorized', false);
    idp.refresh = vi.fn().mockRejectedValue(err);

    await expect(service.ensureFreshAccessToken(record!)).rejects.toThrow(
      'Refresh token revoked or user disabled',
    );

    // Fix 7: revokeRefreshToken should be attempted before destroy
    expect(idp.revokeRefreshToken).toHaveBeenCalled();

    const afterDestroy = await service.get(sessionId);
    expect(afterDestroy).toBeNull();
  });

  it('does not store raw sessionId in the Redis record', async () => {
    const { sessionId } = await service.create(baseInput);
    const hash = hashId(sessionId);
    const raw = (await store.get(sessionKey(hash)))!;
    const parsed = JSON.parse(raw);
    // sessionId must NOT appear in the stored JSON
    expect(parsed).not.toHaveProperty('sessionId');
    expect(parsed.userId).toBe('user_1');
  });

  it('destroy publishes sessionIdHash (not raw sessionId) in the invalidation message', async () => {
    const messages: string[] = [];
    await store.subscribe(INVALIDATE_CHANNEL, (m) => messages.push(m));

    const { sessionId } = await service.create(baseInput);
    await service.destroy(sessionId, { revokeTokens: true });

    expect(messages.length).toBeGreaterThan(0);
    const msg = JSON.parse(messages[0]!);
    expect(msg).not.toHaveProperty('sessionId');
    expect(msg).toHaveProperty('sessionIdHash');
    expect(msg.sessionIdHash).toBe(hashId(sessionId));
  });
});
