/**
 * RedisHealthIndicator: the health check says which key-value store the API
 * runs on, and a PING that never answers fails the check within the timeout
 * instead of hanging it (INFRA-R-08, D-26).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyValueStore } from './key-value-store.js';
import { REDIS_HEALTH_TIMEOUT_MS, RedisHealthIndicator } from './redis-health.indicator.js';

/** A store double that is neither of the real classes, so only its declared `kind` can tell what it is. */
function storeOf(kind: KeyValueStore['kind'], ping: () => Promise<boolean>): KeyValueStore {
  return { kind, ping } as unknown as KeyValueStore;
}

const neverAnswers = (): Promise<boolean> => new Promise<boolean>(() => {});

describe('RedisHealthIndicator', () => {
  describe.each(['memory', 'redis'] as const)('a %s store', (kind) => {
    it('reports up and names the kind the store declares', async () => {
      const indicator = new RedisHealthIndicator(storeOf(kind, async () => true));

      await expect(indicator.isHealthy('redis')).resolves.toMatchObject({
        redis: { status: 'up', mode: kind },
      });
    });
  });

  it('reports down when PING answers false', async () => {
    const indicator = new RedisHealthIndicator(storeOf('redis', async () => false));

    await expect(indicator.isHealthy('redis')).resolves.toMatchObject({
      redis: { status: 'down', message: 'PING failed' },
    });
  });

  it('reports down when PING rejects', async () => {
    const indicator = new RedisHealthIndicator(
      storeOf('redis', async () => {
        throw new Error('connection refused');
      }),
    );

    await expect(indicator.isHealthy('redis')).resolves.toMatchObject({
      redis: { status: 'down', message: 'connection refused' },
    });
  });

  describe('a PING that never answers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Starts the check; the returned getter is `undefined` until the check has settled. Nothing here waits on the real clock. */
    function startCheck(indicator: RedisHealthIndicator): () => unknown {
      let result: unknown;
      void Promise.resolve(indicator.isHealthy('redis')).then((r) => {
        result = r;
      });
      return () => result;
    }

    it(`fails the check when ${REDIS_HEALTH_TIMEOUT_MS} ms of the clock have passed, and not before`, async () => {
      const result = startCheck(new RedisHealthIndicator(storeOf('redis', neverAnswers)));

      await vi.advanceTimersByTimeAsync(REDIS_HEALTH_TIMEOUT_MS - 1);
      expect(result()).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(result()).toMatchObject({
        redis: { status: 'down', message: `timeout of ${REDIS_HEALTH_TIMEOUT_MS}ms exceeded` },
      });
    });

    it.each(['memory', 'redis'] as const)('still names the kind of the %s store that hung', async (kind) => {
      const result = startCheck(new RedisHealthIndicator(storeOf(kind, neverAnswers)));

      await vi.advanceTimersByTimeAsync(REDIS_HEALTH_TIMEOUT_MS);

      expect(result()).toMatchObject({ redis: { status: 'down', mode: kind } });
    });

    it('leaves no timer behind after a PING that answers in time', async () => {
      const indicator = new RedisHealthIndicator(storeOf('redis', async () => true));

      await expect(indicator.isHealthy('redis')).resolves.toMatchObject({ redis: { status: 'up' } });

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
