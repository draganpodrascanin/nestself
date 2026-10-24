/**
 * AvailabilityVersionService — per-org and global availability version counters
 * stored in Redis (ACC-R-20, 5.9.5).
 *
 * Callers (publication, capability, membership, media-rights services) call
 * `bump()` when availability may have changed; read paths include the version
 * in cache keys so that stale data is never served.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../../redis/key-value-store.js';
import {
  availabilityVersionKey,
  availabilityVersionGlobalKey,
} from '../../redis/redis-keys.js';

@Injectable()
export class AvailabilityVersionService {
  constructor(
    @Inject(KEY_VALUE_STORE) private readonly kv: KeyValueStore,
  ) {}

  /**
   * Increment the availability version for the given organization ids.
   * Pass `'global'` to bump the global counter (used when an `all_eligible`
   * audience changes).
   */
  async bump(orgIds: string[] | 'global'): Promise<void> {
    if (orgIds === 'global') {
      await this.kv.incr(availabilityVersionGlobalKey());
      return;
    }
    const promises = orgIds.map((id) =>
      this.kv.incr(availabilityVersionKey(id)),
    );
    await Promise.all(promises);
  }

  /**
   * Read the current availability version for an organization.
   * Returns `0` when no version has been set yet.
   */
  async current(orgId: string): Promise<number> {
    const raw = await this.kv.get(availabilityVersionKey(orgId));
    return raw ? parseInt(raw, 10) : 0;
  }

  /**
   * Read the current global availability version.
   * Returns `0` when no version has been set yet.
   */
  async currentGlobal(): Promise<number> {
    const raw = await this.kv.get(availabilityVersionGlobalKey());
    return raw ? parseInt(raw, 10) : 0;
  }
}
