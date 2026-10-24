import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    expect(JSON.parse(value as string)).toEqual({
      ...RECORD,
      expiresAt: expect.any(Number),
    });
    expect(opts).toEqual({ ttlSeconds: CHALLENGE_TTL });
  });

  it('create() stamps the record with its deadline', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-24T10:00:00Z') });
    try {
      await cs.create(RECORD);
      const stored = JSON.parse(store.set.mock.calls[0]![1] as string) as ChallengeRecord;
      expect(stored.expiresAt).toBe(Date.parse('2026-10-24T10:00:00Z') + CHALLENGE_TTL * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('put()', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('re-stores the record under the same token for the time it had left', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-24T10:00:00Z') });
      const token = await cs.create(RECORD);
      const created = JSON.parse(store.set.mock.calls[0]![1] as string) as ChallengeRecord;

      vi.advanceTimersByTime(120_000);
      await cs.put(token, { ...created, attempts: 1 });

      const hash = createHash('sha256').update(token).digest('hex');
      const [key, value, opts] = store.set.mock.calls[1]!;
      expect(key).toBe(challengeKey(hash));
      expect(JSON.parse(value as string)).toEqual({ ...created, attempts: 1 });
      expect(opts).toEqual({ ttlSeconds: CHALLENGE_TTL - 120 });
    });

    it('does not resurrect a record past its deadline', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-24T10:00:00Z') });
      await cs.put('late', { ...RECORD, expiresAt: Date.now() - 1 });
      expect(store.set).not.toHaveBeenCalled();
    });

    it('gives a record without a deadline at most the full challenge TTL', async () => {
      await cs.put('legacy', RECORD);
      const [, value, opts] = store.set.mock.calls[0]!;
      expect(opts).toEqual({ ttlSeconds: CHALLENGE_TTL });
      expect(JSON.parse(value as string)).toHaveProperty('expiresAt');
    });
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
