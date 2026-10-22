/**
 * Health indicator for the Redis / Valkey connection.
 *
 * Exposed by RedisModule so the existing Terminus health module can add it later
 * without this module editing the health module directly.
 *
 * @see D-26
 */
import { Inject, Injectable } from '@nestjs/common';
import { KEY_VALUE_STORE, type KeyValueStore } from './key-value-store.js';

export interface RedisHealthResult {
  [key: string]: { status: string };
}

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  async isHealthy(key: string): Promise<RedisHealthResult> {
    const ok = await this.store.ping();
    if (ok) {
      return { [key]: { status: 'up' } };
    }
    throw new Error(`Redis health check failed: ${key} is down`);
  }
}
