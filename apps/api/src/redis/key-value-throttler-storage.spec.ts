import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryKeyValueStore } from './memory-key-value-store.js';
import { KeyValueThrottlerStorage } from './key-value-throttler-storage.js';

const MINUTE = 60_000;

describe('KeyValueThrottlerStorage', () => {
  let store: MemoryKeyValueStore;
  let storage: KeyValueThrottlerStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryKeyValueStore();
    storage = new KeyValueThrottlerStorage(store);
  });

  afterEach(async () => {
    await store.close();
    vi.useRealTimers();
  });

  it('counts hits in a window of ttl and reports the seconds left in it', async () => {
    await storage.increment('k', MINUTE, 5, MINUTE, 'default');
    await storage.increment('k', MINUTE, 5, MINUTE, 'default');
    vi.advanceTimersByTime(10_000);
    expect(await storage.increment('k', MINUTE, 5, MINUTE, 'default')).toEqual({
      totalHits: 3,
      timeToExpire: 50,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('keeps the counter at throttle:{throttler}:{key} with the ttl in seconds', async () => {
    await storage.increment('abc', MINUTE, 5, MINUTE, 'default');
    await storage.increment('abc', MINUTE, 5, MINUTE, 'other');
    expect(await store.get('throttle:default:abc')).toBe('1');
    expect(await store.ttl('throttle:default:abc')).toBe(60);
    expect(await store.get('throttle:other:abc')).toBe('1');
  });

  it('blocks the hit after the limit for blockDuration and does not count blocked hits', async () => {
    const hit = () => storage.increment('k', MINUTE, 2, MINUTE, 'default');
    expect((await hit()).isBlocked).toBe(false);
    expect((await hit()).isBlocked).toBe(false);
    expect(await hit()).toEqual({ totalHits: 3, timeToExpire: 60, isBlocked: true, timeToBlockExpire: 60 });
    vi.advanceTimersByTime(30_000);
    expect(await hit()).toEqual({ totalHits: 3, timeToExpire: 30, isBlocked: true, timeToBlockExpire: 30 });
    expect(await store.get('throttle:default:k')).toBe('3');
  });

  it('holds a block for blockDuration past the end of the window, then starts a fresh window', async () => {
    const hit = () => storage.increment('k', 10_000, 1, MINUTE, 'default');
    await hit();
    expect(await hit()).toMatchObject({ isBlocked: true, timeToBlockExpire: 60 });
    vi.advanceTimersByTime(30_000);
    expect(await hit()).toMatchObject({ isBlocked: true, timeToBlockExpire: 30 });
    vi.advanceTimersByTime(30_000);
    expect(await hit()).toEqual({ totalHits: 1, timeToExpire: 10, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('without a block duration refuses hits over the limit until the window ends', async () => {
    const hit = () => storage.increment('k', MINUTE, 1, 0, 'default');
    await hit();
    expect(await hit()).toEqual({ totalHits: 2, timeToExpire: 60, isBlocked: true, timeToBlockExpire: 60 });
    expect(await store.get('throttle:default:k:block')).toBeNull();
    vi.advanceTimersByTime(MINUTE);
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('gives a counter left without a TTL its window again, so no tracker is refused forever', async () => {
    // INCR landed but its EXPIRE did not (the connection dropped between the two).
    await store.set('throttle:default:k', '7');
    expect((await storage.increment('k', MINUTE, 100, MINUTE, 'default')).timeToExpire).toBe(60);
    expect(await store.ttl('throttle:default:k')).toBe(60);
  });
});
