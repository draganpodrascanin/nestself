/**
 * Session service integration tests against real local Valkey.
 *
 * Covers: create -> get -> regenerate -> updateContext -> destroy with
 * pub/sub invalidation delivery, refresh-under-lock concurrency, and
 * TTL verification.
 *
 * Skips when Valkey is unreachable (top-level await probe).
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { RedisKeyValueStore } from '../redis/redis-key-value-store.js';
import { SessionService } from './session.service.js';
import { sessionKey, INVALIDATE_CHANNEL } from '../redis/redis-keys.js';
import type { IdentityProviderService } from '../identity/identity-provider.service.js';
import type { TokenCipher } from './token-cipher.js';
import type { ConfigService } from '@nestjs/config';
import type { CreateSessionInput } from './session.types.js';

config({ path: resolve(import.meta.dirname, '../../.env') });

const REDIS_URL = process.env.REDIS_URL;

// ---------------------------------------------------------------------------
// Top-level reachability probe
// ---------------------------------------------------------------------------
let reachable = false;

if (REDIS_URL) {
  const probe = new RedisKeyValueStore(REDIS_URL);
  try {
    await probe.connect();
    reachable = await probe.ping();
  } catch {
    reachable = false;
  }
  await probe.close();
}

// ---------------------------------------------------------------------------
// Mock helpers (only idp and cipher need mocking; the store is real)
// ---------------------------------------------------------------------------

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

let refreshCallCount = 0;

function makeMockIdp() {
  refreshCallCount = 0;
  return {
    refresh: vi.fn().mockImplementation(async () => {
      refreshCallCount++;
      // Simulate some latency to test locking
      await new Promise((r) => setTimeout(r, 50));
      return {
        accessToken: `new-access-${refreshCallCount}`,
        idToken: `new-id-${refreshCallCount}`,
        refreshToken: `new-refresh-${refreshCallCount}`,
        expiresIn: 900,
      };
    }),
    revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    globalSignOut: vi.fn().mockResolvedValue(undefined),
  } as unknown as IdentityProviderService;
}

function makeConfig(): ConfigService {
  return { get: () => undefined } as unknown as ConfigService;
}

const baseInput: CreateSessionInput = {
  userId: 'integ_user_1',
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
  ip: '10.0.0.1',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let store: RedisKeyValueStore;
let subscriberStore: RedisKeyValueStore;
const keysToClean: string[] = [];

describe.skipIf(!reachable)('SessionService integration (Valkey)', () => {
  let idp: ReturnType<typeof makeMockIdp>;
  let service: SessionService;

  beforeEach(async () => {
    if (!store) {
      store = new RedisKeyValueStore(REDIS_URL!);
      await store.connect();
      subscriberStore = new RedisKeyValueStore(REDIS_URL!);
      await subscriberStore.connect();
    }
    idp = makeMockIdp();
    service = new SessionService(
      store,
      idp as unknown as IdentityProviderService,
      mockCipher,
      makeConfig(),
    );
  });

  afterAll(async () => {
    // Clean up any leftover keys
    if (store && keysToClean.length > 0) {
      await store.del(...keysToClean).catch(() => {});
    }
    if (subscriberStore) await subscriberStore.close();
    if (store) await store.close();
  });

  function trackKey(key: string): void {
    keysToClean.push(key);
  }

  it('create -> get -> regenerate -> updateContext -> destroy with pub/sub', async () => {
    // -- create --
    const { sessionId, csrfToken, absoluteExpiresAt } = await service.create(baseInput);
    const hash = hashId(sessionId);
    trackKey(sessionKey(hash));
    trackKey(`user_sessions:${baseInput.userId}`);

    expect(sessionId).toBeTruthy();
    expect(csrfToken).toBeTruthy();
    expect(absoluteExpiresAt).toBeInstanceOf(Date);

    // -- get --
    const record = await service.get(sessionId);
    expect(record).not.toBeNull();
    expect(record!.userId).toBe('integ_user_1');
    expect(record!.cognito.accessToken).toBe('access-tok');
    expect(record!.context).toEqual({ kind: 'personal' });

    // -- regenerate --
    const { sessionId: newId } = await service.regenerate(sessionId);
    const newHash = hashId(newId);
    trackKey(sessionKey(newHash));
    expect(newId).not.toBe(sessionId);

    const oldResult = await service.get(sessionId);
    expect(oldResult).toBeNull();

    const newResult = await service.get(newId);
    expect(newResult).not.toBeNull();
    expect(newResult!.sessionId).toBe(newId);

    // -- updateContext --
    await service.updateContext(
      newId,
      { kind: 'organization', orgId: 'org_integ_1' },
      'employee',
    );
    const updated = await service.get(newId);
    expect(updated).not.toBeNull();
    expect(updated!.context).toEqual({ kind: 'organization', orgId: 'org_integ_1' });

    // -- destroy with pub/sub --
    const invalidateMessages: string[] = [];
    const unsub = await subscriberStore.subscribe(
      INVALIDATE_CHANNEL,
      (msg) => invalidateMessages.push(msg),
    );

    // Give subscription time to settle
    await new Promise((r) => setTimeout(r, 200));

    await service.destroy(newId, { revokeTokens: true });

    // Give message time to arrive
    await new Promise((r) => setTimeout(r, 300));

    const destroyed = await service.get(newId);
    expect(destroyed).toBeNull();

    // Verify invalidation message was published
    expect(invalidateMessages.length).toBeGreaterThan(0);
    const msg = JSON.parse(invalidateMessages[0]!);
    expect(msg.reason).toBe('session_destroyed');
    expect(msg.userId).toBe('integ_user_1');

    await unsub();
  });

  it('concurrent ensureFreshAccessToken refreshes exactly once', async () => {
    // Create a session with an access token that expires very soon
    const input: CreateSessionInput = {
      ...baseInput,
      userId: 'integ_user_lock',
      tokens: {
        ...baseInput.tokens,
        // Set expiresIn to 1 second so it's already past the refresh threshold
        expiresIn: 1,
      },
    };
    const { sessionId } = await service.create(input);
    const hash = hashId(sessionId);
    trackKey(sessionKey(hash));
    trackKey(`user_sessions:${input.userId}`);
    trackKey(`lock:session:${hashId(sessionId)}`);

    // Wait for the token to be "near expiry" (it already is with expiresIn=1)
    await new Promise((r) => setTimeout(r, 100));

    const record = await service.get(sessionId);
    expect(record).not.toBeNull();

    // Launch two concurrent refresh calls
    const [result1, result2] = await Promise.all([
      service.ensureFreshAccessToken(record!),
      service.ensureFreshAccessToken(record!),
    ]);

    // Both should succeed with valid tokens
    expect(result1.cognito.accessToken).toBeTruthy();
    expect(result2.cognito.accessToken).toBeTruthy();

    // The IDP refresh should have been called exactly once (lock prevents second call)
    expect(idp.refresh).toHaveBeenCalledTimes(1);

    // Cleanup
    await service.destroy(sessionId).catch(() => {});
  });

  it('TTL on the session key equals seconds to absoluteExpiresAt within +/-2s', async () => {
    const { sessionId, absoluteExpiresAt } = await service.create(baseInput);
    const hash = hashId(sessionId);
    trackKey(sessionKey(hash));
    trackKey(`user_sessions:${baseInput.userId}`);

    const ttl = await store.ttl(sessionKey(hash));
    const expectedSeconds = Math.floor(
      (absoluteExpiresAt.getTime() - Date.now()) / 1_000,
    );

    expect(Math.abs(ttl - expectedSeconds)).toBeLessThanOrEqual(2);

    // Cleanup
    await service.destroy(sessionId).catch(() => {});
  });
});
