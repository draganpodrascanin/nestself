import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryKeyValueStore } from './memory-key-value-store.js';

describe('MemoryKeyValueStore', () => {
  let store: MemoryKeyValueStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryKeyValueStore();
  });

  afterEach(async () => {
    await store.close();
    vi.useRealTimers();
  });

  // -- basic get/set --------------------------------------------------------

  it('returns null for a missing key', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('stores and retrieves a value', async () => {
    await store.set('k', 'v');
    expect(await store.get('k')).toBe('v');
  });

  // -- TTL expiry -----------------------------------------------------------

  it('expires a key after the TTL elapses', async () => {
    await store.set('k', 'v', { ttlSeconds: 10 });
    expect(await store.get('k')).toBe('v');

    vi.advanceTimersByTime(10_001);
    expect(await store.get('k')).toBeNull();
  });

  it('reports remaining TTL', async () => {
    await store.set('k', 'v', { ttlSeconds: 30 });
    const remaining = await store.ttl('k');
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  });

  it('returns -1 for keys without TTL', async () => {
    await store.set('k', 'v');
    expect(await store.ttl('k')).toBe(-1);
  });

  it('returns -2 for missing keys', async () => {
    expect(await store.ttl('nope')).toBe(-2);
  });

  it('updates TTL with expire()', async () => {
    await store.set('k', 'v');
    await store.expire('k', 5);
    expect(await store.ttl('k')).toBeGreaterThan(0);
    vi.advanceTimersByTime(5_001);
    expect(await store.get('k')).toBeNull();
  });

  // -- NX (onlyIfAbsent) ---------------------------------------------------

  it('set with onlyIfAbsent returns false when key exists', async () => {
    await store.set('k', 'first');
    const ok = await store.set('k', 'second', { onlyIfAbsent: true });
    expect(ok).toBe(false);
    expect(await store.get('k')).toBe('first');
  });

  it('set with onlyIfAbsent returns true when key is new', async () => {
    const ok = await store.set('k', 'val', { onlyIfAbsent: true });
    expect(ok).toBe(true);
    expect(await store.get('k')).toBe('val');
  });

  // -- del ------------------------------------------------------------------

  it('del returns count of deleted keys', async () => {
    await store.set('a', '1');
    await store.set('b', '2');
    expect(await store.del('a', 'b', 'c')).toBe(2);
    expect(await store.get('a')).toBeNull();
  });

  // -- getDel ---------------------------------------------------------------

  it('getDel returns the value and removes the key', async () => {
    await store.set('k', 'v');
    expect(await store.getDel('k')).toBe('v');
    expect(await store.get('k')).toBeNull();
  });

  it('getDel returns null for missing key', async () => {
    expect(await store.getDel('nope')).toBeNull();
  });

  // -- incr -----------------------------------------------------------------

  it('incr returns 1 for new key', async () => {
    expect(await store.incr('counter')).toBe(1);
  });

  it('incr increments existing key', async () => {
    await store.incr('counter');
    expect(await store.incr('counter')).toBe(2);
  });

  it('incr sets TTL only when key is new', async () => {
    await store.incr('counter', 60);
    expect(await store.ttl('counter')).toBeGreaterThan(0);
    // Second incr should not reset TTL
    vi.advanceTimersByTime(30_000);
    await store.incr('counter');
    const remaining = await store.ttl('counter');
    expect(remaining).toBeLessThanOrEqual(30);
  });

  // -- sets -----------------------------------------------------------------

  it('sAdd adds members and sMembers returns them', async () => {
    await store.sAdd('s', 'a', 'b', 'c');
    const members = await store.sMembers('s');
    expect(members.sort()).toEqual(['a', 'b', 'c']);
  });

  it('sRem removes members', async () => {
    await store.sAdd('s', 'a', 'b');
    await store.sRem('s', 'a');
    expect(await store.sMembers('s')).toEqual(['b']);
  });

  it('sMembers returns empty array for missing key', async () => {
    expect(await store.sMembers('nope')).toEqual([]);
  });

  // -- pub/sub --------------------------------------------------------------

  it('subscribe receives published messages', async () => {
    const received: string[] = [];
    await store.subscribe('ch', (msg) => received.push(msg));
    await store.publish('ch', 'hello');
    expect(received).toEqual(['hello']);
  });

  it('unsubscribe stops delivery', async () => {
    const received: string[] = [];
    const unsub = await store.subscribe('ch', (msg) => received.push(msg));
    await store.publish('ch', 'one');
    await unsub();
    await store.publish('ch', 'two');
    expect(received).toEqual(['one']);
  });

  // -- ping -----------------------------------------------------------------

  it('ping returns true', async () => {
    expect(await store.ping()).toBe(true);
  });
});
