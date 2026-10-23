/**
 * Integration tests for RedisKeyValueStore against a real Redis/Valkey instance.
 *
 * Reads REDIS_URL from apps/api/.env via dotenv.
 * Skips the suite when the server is unreachable (top-level await probe).
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RedisKeyValueStore } from './redis-key-value-store.js';

config({ path: resolve(import.meta.dirname, '../../.env') });

const REDIS_URL = process.env.REDIS_URL;

// ---------------------------------------------------------------------------
// Top-level reachability probe (evaluated before `describe`)
// ---------------------------------------------------------------------------
let reachable = false;
let probeStore: RedisKeyValueStore | null = null;

if (REDIS_URL) {
  probeStore = new RedisKeyValueStore(REDIS_URL);
  try {
    await probeStore.connect();
    reachable = await probeStore.ping();
  } catch {
    reachable = false;
  }
  await probeStore.close();
  probeStore = null;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let store: RedisKeyValueStore;
const cleanupKeys: string[] = [];
const cleanupUnsubs: Array<() => Promise<void>> = [];

function makePrefix(): string {
  return `test:${randomBytes(6).toString('hex')}:`;
}

describe.skipIf(!reachable)('RedisKeyValueStore', () => {
  const prefix = makePrefix();
  const k = (name: string) => {
    const full = `${prefix}${name}`;
    cleanupKeys.push(full);
    return full;
  };

  afterEach(async () => {
    if (cleanupKeys.length > 0) {
      await store.del(...cleanupKeys).catch(() => {});
      cleanupKeys.length = 0;
    }
    for (const unsub of cleanupUnsubs) {
      await unsub().catch(() => {});
    }
    cleanupUnsubs.length = 0;
  });

  afterAll(async () => {
    if (store) await store.close();
  });

  // Lazy connect — runs once when the first test executes
  async function ensureConnected(): Promise<void> {
    if (!store) {
      store = new RedisKeyValueStore(REDIS_URL!);
      await store.connect();
    }
  }

  it('set and get', async () => {
    await ensureConnected();
    await store.set(k('a'), 'hello');
    expect(await store.get(`${prefix}a`)).toBe('hello');
  });

  it('set with TTL and expiry', async () => {
    await ensureConnected();
    await store.set(k('ttl'), 'val', { ttlSeconds: 2 });
    expect(await store.get(`${prefix}ttl`)).toBe('val');
    const remaining = await store.ttl(`${prefix}ttl`);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(2);
  });

  it('set NX returns false when key exists', async () => {
    await ensureConnected();
    await store.set(k('nx'), 'first');
    const ok = await store.set(`${prefix}nx`, 'second', { onlyIfAbsent: true });
    expect(ok).toBe(false);
    expect(await store.get(`${prefix}nx`)).toBe('first');
  });

  it('del returns count', async () => {
    await ensureConnected();
    await store.set(k('d1'), 'a');
    await store.set(k('d2'), 'b');
    expect(await store.del(`${prefix}d1`, `${prefix}d2`, `${prefix}d3`)).toBe(2);
  });

  it('getDel returns value and removes key', async () => {
    await ensureConnected();
    await store.set(k('gd'), 'val');
    expect(await store.getDel(`${prefix}gd`)).toBe('val');
    expect(await store.get(`${prefix}gd`)).toBeNull();
  });

  it('incr increments and sets TTL on new key', async () => {
    await ensureConnected();
    const key = k('inc');
    expect(await store.incr(key, 60)).toBe(1);
    expect(await store.incr(key)).toBe(2);
    const remaining = await store.ttl(key);
    expect(remaining).toBeGreaterThan(0);
  });

  it('sets: sAdd, sMembers, sRem', async () => {
    await ensureConnected();
    const key = k('set');
    await store.sAdd(key, 'a', 'b', 'c');
    const members = (await store.sMembers(key)).sort();
    expect(members).toEqual(['a', 'b', 'c']);
    await store.sRem(key, 'b');
    expect((await store.sMembers(key)).sort()).toEqual(['a', 'c']);
  });

  it('scan returns keys matching a pattern', async () => {
    await ensureConnected();
    await store.set(k('scan:one'), '1');
    await store.set(k('scan:two'), '2');
    await store.set(k('other'), '3');
    const keys = await store.scan(`${prefix}scan:*`);
    expect(keys.sort()).toEqual([k('scan:one'), k('scan:two')].sort());
  });

  it('expire updates TTL', async () => {
    await ensureConnected();
    const key = k('exp');
    await store.set(key, 'v');
    expect(await store.ttl(key)).toBe(-1);
    await store.expire(key, 10);
    expect(await store.ttl(key)).toBeGreaterThan(0);
  });

  it('pub/sub delivers messages', async () => {
    await ensureConnected();
    const channel = `${prefix}chan`;
    const received: string[] = [];
    const unsub = await store.subscribe(channel, (msg) => received.push(msg));
    cleanupUnsubs.push(unsub);

    // Give subscription time to settle
    await new Promise((r) => setTimeout(r, 200));
    await store.publish(channel, 'hello');
    // Give message time to arrive
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toContain('hello');
  });
});
