/**
 * Health indicator for the Redis / Valkey connection, registered in
 * `GET /api/health` next to the database (INFRA-R-08, D-24).
 *
 * Reports `mode: 'redis'` for a real connection and `mode: 'memory'` for the
 * in-memory store (stub mode and tests without `REDIS_URL`), so a reader can
 * tell an `up` that proves connectivity from one that does not. A failed or
 * hung `PING` reports `down`, which turns the whole check into a 503.
 *
 * Terminus's `HealthIndicatorService` has no dependencies, so the indicator
 * holds its own instance and `RedisModule` stays free of `TerminusModule`.
 *
 * @see D-26
 */
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { KEY_VALUE_STORE, type KeyValueStore } from './key-value-store.js';
import { MemoryKeyValueStore } from './memory-key-value-store.js';

/** A node-redis client queues commands while reconnecting; do not let the probe wait on that. */
export const REDIS_HEALTH_TIMEOUT_MS = 3_000;

@Injectable()
export class RedisHealthIndicator {
  private readonly indicators = new HealthIndicatorService();

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  isHealthy<const Key extends string>(key: Key) {
    const mode = this.store instanceof MemoryKeyValueStore ? 'memory' : 'redis';
    return this.indicators
      .check(key)
      .attempt(async () => {
        if (!(await this.store.ping())) throw new Error('PING failed');
        return { mode };
      })
      .withTimeout(REDIS_HEALTH_TIMEOUT_MS);
  }
}
