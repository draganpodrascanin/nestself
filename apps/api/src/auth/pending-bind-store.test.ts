/**
 * PendingBindStore unit tests: the record of a pending federated binding
 * (phase 4 design 5.6) over the in-memory key-value store with the real
 * TokenCipher. The store holds neither the handle nor a readable token.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { createFakeTokenSet } from '../identity/fake-token-factory.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { SSO_PENDING_BIND_TTL, ssoPendingBindKey } from '../redis/redis-keys.js';
import { TokenCipher } from '../session/token-cipher.js';
import { PendingBindStore, pendingBindId, type PendingBindInput } from './pending-bind-store.js';

const cipherWith = (key: string) =>
  new TokenCipher({ get: (name: string) => (name === 'SESSION_ENCRYPTION_KEY' ? key : undefined) } as never);

function setup() {
  const store = new MemoryKeyValueStore();
  const pendingBinds = new PendingBindStore(store, cipherWith('cd'.repeat(32)));
  return { store, pendingBinds };
}

function input(overrides: Partial<PendingBindInput> = {}): PendingBindInput {
  return {
    connectionId: 'conn_1',
    providerName: 'org-acme-oidc',
    sub: 'sub-1',
    username: 'org-acme-oidc_idp-1',
    email: 'maria@acme.example',
    surface: 'workspace',
    returnPath: '/people',
    testSignIn: false,
    tokens: createFakeTokenSet('sub-1', 'org-acme-oidc_idp-1'),
    ...overrides,
  };
}

describe('PendingBindStore', () => {
  it('opens a record under the hash of a fresh 32-byte handle for SSO_PENDING_BIND_TTL', async () => {
    const { store, pendingBinds } = setup();
    const handle = await pendingBinds.open(input());

    expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(handle, 'base64url')).toHaveLength(32);
    const id = createHash('sha256').update(handle).digest('hex');
    expect(pendingBindId(handle)).toBe(id);
    expect(await store.ttl(ssoPendingBindKey(id))).toBeGreaterThan(SSO_PENDING_BIND_TTL - 5);
    expect(SSO_PENDING_BIND_TTL).toBe(900);
    expect(await pendingBinds.open(input())).not.toBe(handle);
  });

  it('stores the tokens encrypted and never the handle', async () => {
    const { store, pendingBinds } = setup();
    const { tokens } = input();
    const handle = await pendingBinds.open(input({ tokens }));
    const raw = (await store.get(ssoPendingBindKey(pendingBindId(handle))))!;

    for (const secret of [handle, tokens.accessToken, tokens.idToken, tokens.refreshToken!]) {
      expect(raw).not.toContain(secret);
    }
    const stored = JSON.parse(raw) as { tokens: Record<string, unknown> };
    expect(stored.tokens).toEqual({
      accessToken: expect.stringMatching(/^v1\./),
      idToken: expect.stringMatching(/^v1\./),
      refreshToken: expect.stringMatching(/^v1\./),
      expiresIn: tokens.expiresIn,
    });
  });

  it('peek reads the record and leaves it; take hands it over once, with the tokens decrypted', async () => {
    // Time stands still, so the tokens keep their whole lifetime.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { pendingBinds } = setup();
      const { tokens, ...rest } = input();
      const handle = await pendingBinds.open({ ...rest, tokens });
      const id = pendingBindId(handle);

      const peeked = await pendingBinds.peek(id);
      expect(peeked).toMatchObject({ ...rest, createdAt: expect.any(String) });
      expect(await pendingBinds.peek(id)).not.toBeNull();

      const taken = await pendingBinds.take(id);
      expect(taken).toEqual({ ...rest, tokens, createdAt: peeked!.createdAt });
      expect(await pendingBinds.take(id)).toBeNull();
      expect(await pendingBinds.peek(id)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('take hands the tokens over with the lifetime they have left, never less than nothing', async () => {
    const { pendingBinds } = setup();
    const fresh = await pendingBinds.open(input({ tokens: { ...createFakeTokenSet('sub-1', 'u'), expiresIn: 900 } }));
    const shortLived = await pendingBinds.open(input({ tokens: { ...createFakeTokenSet('sub-2', 'v'), expiresIn: 300 } }));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 600_000 });
    try {
      // The session counts its access-token expiry from now: it must not get the 900 s of the exchange.
      expect((await pendingBinds.take(pendingBindId(fresh)))!.tokens.expiresIn).toBe(300);
      expect((await pendingBinds.take(pendingBindId(shortLived)))!.tokens.expiresIn).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([true, false])('keeps whether a staff test sign-in opened the record (testSignIn %s)', async (testSignIn) => {
    const { pendingBinds } = setup();
    const id = pendingBindId(await pendingBinds.open(input({ testSignIn })));
    expect((await pendingBinds.peek(id))!.testSignIn).toBe(testSignIn);
    expect((await pendingBinds.take(id))!.testSignIn).toBe(testSignIn);
  });

  it.each([
    ['without the flag', undefined],
    ['with a flag that is not a boolean', 'true'],
  ])('answers null for a record %s', async (_label, flag) => {
    const { store, pendingBinds } = setup();
    const id = pendingBindId(await pendingBinds.open(input()));
    const { testSignIn: _drop, ...record } = JSON.parse((await store.get(ssoPendingBindKey(id)))!) as Record<string, unknown>;
    await store.set(ssoPendingBindKey(id), JSON.stringify(flag === undefined ? record : { ...record, testSignIn: flag }), {
      ttlSeconds: 60,
    });
    expect(await pendingBinds.peek(id)).toBeNull();
    expect(await pendingBinds.take(id)).toBeNull();
  });

  it('keeps a missing refresh token as null', async () => {
    const { pendingBinds } = setup();
    const tokens = { ...createFakeTokenSet('sub-1', 'u'), refreshToken: null };
    const handle = await pendingBinds.open(input({ tokens }));
    expect((await pendingBinds.take(pendingBindId(handle)))!.tokens.refreshToken).toBeNull();
  });

  it('answers null for an unknown id and for a record it cannot read', async () => {
    const { store, pendingBinds } = setup();
    expect(await pendingBinds.peek(pendingBindId('unknown'))).toBeNull();
    await store.set(ssoPendingBindKey('broken'), '{"connectionId":1}', { ttlSeconds: 60 });
    expect(await pendingBinds.peek('broken')).toBeNull();
    await store.set(ssoPendingBindKey('not-json'), 'nope', { ttlSeconds: 60 });
    expect(await pendingBinds.take('not-json')).toBeNull();
    // A whole record whose creation time is not a time (its tokens' age would be unknown).
    const id = pendingBindId(await pendingBinds.open(input()));
    const record = JSON.parse((await store.get(ssoPendingBindKey(id)))!) as Record<string, unknown>;
    await store.set(ssoPendingBindKey(id), JSON.stringify({ ...record, createdAt: 'yesterday' }), { ttlSeconds: 60 });
    expect(await pendingBinds.take(id)).toBeNull();
  });

  it('take answers null, with a warning, when the tokens no longer decrypt (key rotated out)', async () => {
    const { store, pendingBinds } = setup();
    const handle = await new PendingBindStore(store, cipherWith('ef'.repeat(32))).open(input());
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      expect(await pendingBinds.take(pendingBindId(handle))).toBeNull();
      expect(warn).toHaveBeenCalledWith('Pending SSO binding unreadable: its tokens do not decrypt');
    } finally {
      warn.mockRestore();
    }
  });
});
