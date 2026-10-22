import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { ChallengeStore, type ChallengeRecord } from './challenge-store.js';
import { challengeKey, CHALLENGE_TTL } from '../redis/redis-keys.js';

function createMockStore() {
  return {
    set: vi.fn(),
    get: vi.fn(),
    getDel: vi.fn(),
    del: vi.fn(),
  };
}

describe('ChallengeStore', () => {
  let store: ReturnType<typeof createMockStore>;
  let cs: ChallengeStore;

  beforeEach(() => {
    store = createMockStore();
    cs = new ChallengeStore(store as never);
  });

  const RECORD: ChallengeRecord = {
    kind: 'email_otp',
    username: 'u',
    email: 'a@b.c',
    session: 'sess-1',
  };

  it('create() returns a base64url token and stores hashed', async () => {
    const token = await cs.create(RECORD);

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(store.set).toHaveBeenCalledOnce();

    const [key, value, opts] = store.set.mock.calls[0]!;
    const expectedHash = createHash('sha256').update(token).digest('hex');
    expect(key).toBe(challengeKey(expectedHash));
    expect(JSON.parse(value as string)).toEqual(RECORD);
    expect(opts).toEqual({ ttlSeconds: CHALLENGE_TTL });
  });

  it('consume() returns the record and deletes it (single-use)', async () => {
    const token = 'fake-token-abc';
    const hash = createHash('sha256').update(token).digest('hex');
    store.getDel.mockResolvedValue(JSON.stringify(RECORD));

    const result = await cs.consume(token);

    expect(result).toEqual(RECORD);
    expect(store.getDel).toHaveBeenCalledWith(challengeKey(hash));
  });

  it('consume() returns null when token expired or already used', async () => {
    store.getDel.mockResolvedValue(null);
    const result = await cs.consume('gone-token');
    expect(result).toBeNull();
  });

  it('remove() deletes the challenge key', async () => {
    const token = 'to-remove';
    const hash = createHash('sha256').update(token).digest('hex');
    await cs.remove(token);
    expect(store.del).toHaveBeenCalledWith(challengeKey(hash));
  });
});
