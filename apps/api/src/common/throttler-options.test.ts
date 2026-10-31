import { describe, it, expect } from 'vitest';
import type { KeyValueStore } from '../redis/key-value-store.js';
import { KeyValueThrottlerStorage } from '../redis/key-value-throttler-storage.js';
import { throttlerModuleOptions } from './throttler-options.js';

const store = {} as KeyValueStore;
const config = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] });

describe('throttlerModuleOptions', () => {
  it('keeps the app-wide 60 a minute per client', () => {
    expect(throttlerModuleOptions(config({}), store)).toMatchObject({ throttlers: [{ ttl: 60_000, limit: 60 }] });
  });

  it('counts in the key-value store when REDIS_URL is set, so every API task shares the budget', () => {
    const options = throttlerModuleOptions(config({ REDIS_URL: 'redis://localhost:6379' }), store);
    expect(!Array.isArray(options) && options.storage).toBeInstanceOf(KeyValueThrottlerStorage);
  });

  it('leaves the in-memory default storage without REDIS_URL (local development and tests)', () => {
    expect(throttlerModuleOptions(config({}), store)).not.toHaveProperty('storage');
    expect(throttlerModuleOptions(config({ REDIS_URL: '' }), store)).not.toHaveProperty('storage');
  });
});
