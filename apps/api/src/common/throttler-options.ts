/**
 * `ThrottlerModule` options: 60 requests a minute per client IP unless a
 * route sets its own throttle (`authz/throttles.ts`).
 *
 * With `REDIS_URL` the counters live in Redis, so the 2 to 8 API tasks of a
 * stage share one budget per client. Without it (local development, tests)
 * the module keeps its in-memory `ThrottlerStorageService`, which
 * `test/throttler-reset.ts` clears between tests.
 *
 * @see 5.9 Throttling and proxies
 */
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { KeyValueStore } from '../redis/key-value-store.js';
import { KeyValueThrottlerStorage } from '../redis/key-value-throttler-storage.js';

/** What the factory reads; `ConfigService` satisfies it. */
interface EnvConfig {
  get(key: string): string | undefined;
}

export function throttlerModuleOptions(config: EnvConfig, store: KeyValueStore): ThrottlerModuleOptions {
  return {
    throttlers: [{ ttl: 60_000, limit: 60 }],
    ...(config.get('REDIS_URL') ? { storage: new KeyValueThrottlerStorage(store) } : {}),
  };
}
