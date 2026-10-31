/**
 * `ThrottlerStorage` over the {@link KeyValueStore}, so every API task counts
 * against one budget per tracker (the in-memory storage counts per process).
 * Wired only when `REDIS_URL` is set (`throttler-options.ts`).
 *
 * A fixed window per key: INCR, with the TTL set on the first hit. Blocking
 * follows the memory storage: the hit past the limit starts a block of
 * `blockDuration` (the guard passes the route's ttl unless one is set), a
 * hit inside a block is refused without being counted, and the first hit
 * after the block opens a fresh window. Times are in seconds, as the guard
 * expects.
 *
 * @see 5.9 Throttling and proxies
 */
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { KeyValueStore } from './key-value-store.js';
import { throttleKey } from './redis-keys.js';

/** `{ totalHits, timeToExpire, isBlocked, timeToBlockExpire }`; the package index does not export the name. */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** Whole seconds, at least 1 (Redis refuses a zero expiry). */
function toSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export class KeyValueThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly store: KeyValueStore) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = throttleKey(throttlerName, key);
    const blockKey = `${hitsKey}:block`;

    const blockedFor = blockDuration > 0 ? await this.secondsLeft(blockKey) : 0;
    if (blockedFor > 0) {
      return {
        totalHits: Number(await this.store.get(hitsKey)) || 0,
        timeToExpire: await this.secondsLeft(hitsKey),
        isBlocked: true,
        timeToBlockExpire: blockedFor,
      };
    }

    const totalHits = await this.store.incr(hitsKey, toSeconds(ttl));
    let timeToExpire = await this.store.ttl(hitsKey);
    if (timeToExpire === -1) {
      // The INCR of a first hit landed but its EXPIRE did not: without a TTL
      // the counter would refuse this tracker forever.
      await this.store.expire(hitsKey, toSeconds(ttl));
      timeToExpire = toSeconds(ttl);
    }
    timeToExpire = Math.max(0, timeToExpire);

    if (totalHits <= limit) {
      return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
    }
    if (blockDuration <= 0) {
      return { totalHits, timeToExpire, isBlocked: true, timeToBlockExpire: timeToExpire };
    }
    await this.store.set(blockKey, '1', { ttlSeconds: toSeconds(blockDuration), onlyIfAbsent: true });
    return { totalHits, timeToExpire, isBlocked: true, timeToBlockExpire: await this.secondsLeft(blockKey) };
  }

  /** Seconds until `key` expires; 0 when it is missing. */
  private async secondsLeft(key: string): Promise<number> {
    return Math.max(0, await this.store.ttl(key));
  }
}
