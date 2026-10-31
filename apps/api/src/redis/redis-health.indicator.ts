/**
 * Health indicator for the Redis / Valkey connection, registered in
 * `GET /api/health` next to the database (INFRA-R-08, D-24).
 *
 * Reports `mode: 'redis'` for a real connection and `mode: 'memory'` for the
 * in-memory store (stub mode and tests without `REDIS_URL`), as the store
 * declares in its own `kind`, so a reader can tell an `up` that proves
 * connectivity from one that does not. A failed `PING`, or one that has not
 * answered within `REDIS_HEALTH_TIMEOUT_MS`, reports `down` under the same
 * mode, which turns the whole check into a 503 instead of hanging it.
 *
 * The limit is a `setTimeout` race rather than Terminus's `withTimeout()`:
 * that one runs on `AbortSignal.timeout`, a native timer that fake timers do
 * not advance, so its 3 seconds could only be tested by waiting 3 real seconds.
 *
 * Terminus's `HealthIndicatorService` has no dependencies, so the indicator
 * holds its own instance and `RedisModule` stays free of `TerminusModule`.
 *
 * @see D-26
 */
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { KEY_VALUE_STORE, type KeyValueStore } from './key-value-store.js';

/** A node-redis client queues commands while reconnecting; do not let the probe wait on that. */
export const REDIS_HEALTH_TIMEOUT_MS = 3_000;

/** Rejects, in Terminus's wording, when `promise` has not settled after `ms`. The timer never outlives the call. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout of ${ms}ms exceeded`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class RedisHealthIndicator {
  private readonly indicators = new HealthIndicatorService();

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  async isHealthy<const Key extends string>(key: Key) {
    const check = this.indicators.check(key);
    const mode = this.store.kind;
    const startedAt = performance.now();
    const responseTime = () => Math.round(performance.now() - startedAt);
    try {
      if (!(await withTimeout(this.store.ping(), REDIS_HEALTH_TIMEOUT_MS))) throw new Error('PING failed');
      return check.up({ mode, responseTime: responseTime() });
    } catch (err) {
      return check.down({ mode, message: err instanceof Error ? err.message : String(err), responseTime: responseTime() });
    }
  }
}
