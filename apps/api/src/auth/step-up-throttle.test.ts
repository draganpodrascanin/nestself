import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { StepUpThrottle } from './step-up-throttle.js';

const NOW = new Date('2026-10-31T10:00:00Z');

describe('StepUpThrottle', () => {
  let store: MemoryKeyValueStore;
  let throttle: StepUpThrottle;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    store = new MemoryKeyValueStore();
    throttle = new StepUpThrottle(store);
  });

  afterEach(async () => {
    await store.close();
    vi.useRealTimers();
  });

  async function fail(userId: string, times: number): Promise<void> {
    for (let i = 0; i < times; i++) await throttle.recordFailure(userId);
  }

  it('four wrong codes leave the user unlocked; the fifth locks', async () => {
    await fail('user-1', 4);
    expect(await throttle.isLocked('user-1')).toBe(false);

    await throttle.recordFailure('user-1');
    expect(await throttle.isLocked('user-1')).toBe(true);
  });

  it('counts each user on its own', async () => {
    await fail('user-1', 5);
    expect(await throttle.isLocked('user-2')).toBe(false);
  });

  it('counts under throttle:step_up:{userId} for 900 s from the first failure', async () => {
    await throttle.recordFailure('user-1');
    vi.advanceTimersByTime(600_000);
    await fail('user-1', 4);

    expect(await store.get('throttle:step_up:user-1')).toBe('5');
    // The window is not extended by later failures.
    expect(await store.ttl('throttle:step_up:user-1')).toBe(300);

    vi.advanceTimersByTime(299_000);
    expect(await throttle.isLocked('user-1')).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(await throttle.isLocked('user-1')).toBe(false);
  });

  it('reset clears the count', async () => {
    await fail('user-1', 5);
    await throttle.reset('user-1');

    expect(await throttle.isLocked('user-1')).toBe(false);
    await fail('user-1', 4);
    expect(await throttle.isLocked('user-1')).toBe(false);
  });
});
