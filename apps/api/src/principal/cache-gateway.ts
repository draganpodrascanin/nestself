/**
 * CacheGateway — Redis cache with circuit breaker fallback.
 *
 * When Redis is unavailable (3 consecutive failures), the circuit opens
 * and reads fall back to an in-memory LRU cache (100 entries, 10 s TTL).
 * The circuit probes Redis every 5 s.
 *
 * @see AUTHZ-R-45, 4.5.11
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';

const FAILURE_THRESHOLD = 3;
const PROBE_INTERVAL_MS = 5_000;
const LRU_MAX_ENTRIES = 100;
const LRU_TTL_MS = 10_000;

interface LruEntry {
  value: string;
  expiresAt: number;
}

@Injectable()
export class CacheGateway {
  private readonly logger = new Logger(CacheGateway.name);
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private lastProbeAt = 0;
  private readonly lru = new Map<string, LruEntry>();

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  /** Read from Redis, falling back to LRU when the circuit is open. */
  async get(key: string): Promise<string | null> {
    if (this.circuitOpen) {
      if (this.shouldProbe()) {
        try {
          const result = await this.store.get(key);
          this.closeCircuit();
          if (result) this.lruSet(key, result);
          return result;
        } catch {
          this.lastProbeAt = Date.now();
          return this.lruGet(key);
        }
      }
      return this.lruGet(key);
    }

    try {
      const result = await this.store.get(key);
      this.consecutiveFailures = 0;
      if (result) this.lruSet(key, result);
      return result;
    } catch (err) {
      this.consecutiveFailures++;
      this.logger.warn(
        `Redis read failed (${this.consecutiveFailures}/${FAILURE_THRESHOLD}): ${String(err)}`,
      );
      if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
        this.openCircuit();
      }
      return this.lruGet(key);
    }
  }

  /** Write to Redis. Does not fail when the circuit is open (fire-and-forget). */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.lruSet(key, value);
    if (this.circuitOpen) return;
    try {
      await this.store.set(key, value, { ttlSeconds });
      this.consecutiveFailures = 0;
    } catch {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
        this.openCircuit();
      }
    }
  }

  /** Delete from Redis and LRU. */
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.lru.delete(k);
    if (this.circuitOpen) return;
    try {
      await this.store.del(...keys);
    } catch {
      // Ignore on circuit-open path
    }
  }

  /** Purge all LRU entries matching a prefix. */
  purgeLru(prefix: string): void {
    for (const key of this.lru.keys()) {
      if (key.startsWith(prefix)) this.lru.delete(key);
    }
  }

  private lruGet(key: string): string | null {
    const entry = this.lru.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.lru.delete(key);
      return null;
    }
    return entry.value;
  }

  private lruSet(key: string, value: string): void {
    if (this.lru.size >= LRU_MAX_ENTRIES) {
      const oldest = this.lru.keys().next().value;
      if (oldest != null) this.lru.delete(oldest);
    }
    this.lru.set(key, { value, expiresAt: Date.now() + LRU_TTL_MS });
  }

  private shouldProbe(): boolean {
    return Date.now() - this.lastProbeAt >= PROBE_INTERVAL_MS;
  }

  private openCircuit(): void {
    if (!this.circuitOpen) {
      this.logger.warn('Circuit breaker OPEN — falling back to LRU cache');
    }
    this.circuitOpen = true;
    this.lastProbeAt = Date.now();
  }

  private closeCircuit(): void {
    if (this.circuitOpen) {
      this.logger.log('Circuit breaker CLOSED — Redis is back');
    }
    this.circuitOpen = false;
    this.consecutiveFailures = 0;
  }
}
