/**
 * Abstract key-value store interface for Redis and in-memory implementations.
 *
 * @see D-26, SESS-R-09, AUTH-R-11
 */

/** Injection token for the KeyValueStore. */
export const KEY_VALUE_STORE = Symbol('KEY_VALUE_STORE');

export interface SetOptions {
  /** Time-to-live in seconds. */
  ttlSeconds?: number;
  /** Only set if the key does not already exist (NX). */
  onlyIfAbsent?: boolean;
}

/**
 * Thin abstraction over Redis (or an in-memory store for tests and stub mode).
 * Every method surfaces errors as `RedisUnavailableError` in the Redis implementation.
 */
export interface KeyValueStore {
  /**
   * Which implementation this is. Each implementation declares it, so the
   * health check can say what the API runs on without guessing from the class:
   * an `up` from the in-memory store proves nothing about Redis.
   */
  readonly kind: 'memory' | 'redis';

  get(key: string): Promise<string | null>;

  /**
   * Set a key to a value.
   * @returns `false` when `onlyIfAbsent` is true and the key already exists.
   */
  set(key: string, value: string, opts?: SetOptions): Promise<boolean>;

  /** Delete one or more keys. Returns the number of keys removed. */
  del(...keys: string[]): Promise<number>;

  /** Get and delete atomically. */
  getDel(key: string): Promise<string | null>;

  /** Set the TTL (in seconds) on an existing key. */
  expire(key: string, ttlSeconds: number): Promise<boolean>;

  /** Returns the remaining TTL in seconds, or -1 if no TTL, or -2 if key is missing. */
  ttl(key: string): Promise<number>;

  /**
   * Increment a key by 1. Sets the TTL only when the key is newly created.
   * @returns The value after incrementing.
   */
  incr(key: string, ttlSeconds?: number): Promise<number>;

  /** Add members to a set. */
  sAdd(key: string, ...members: string[]): Promise<number>;

  /** Remove members from a set. */
  sRem(key: string, ...members: string[]): Promise<number>;

  /** Return all members of a set. */
  sMembers(key: string): Promise<string[]>;

  /**
   * Return every key matching a glob pattern (`SCAN` in Redis, a filter in
   * memory). For maintenance jobs only: it walks the whole keyspace, so request
   * paths must never call it.
   */
  scan(pattern: string): Promise<string[]>;

  /** Publish a message to a channel. */
  publish(channel: string, message: string): Promise<number>;

  /**
   * Subscribe to a channel. Returns an unsubscribe function.
   * In-memory: synchronous dispatch. Redis: via a dedicated subscriber client.
   */
  subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<() => Promise<void>>;

  /**
   * Atomically delete a key only if its current value exactly equals
   * `expectedValue`. Used for compare-and-delete idempotency reservations
   * so a stale holder cannot release a key that was re-reserved by another
   * process after TTL expiry.
   *
   * Redis: Lua script for atomicity.  Memory: single-threaded, safe as-is.
   * @returns `true` if the key existed with the expected value and was deleted.
   */
  compareAndDelete(key: string, expectedValue: string): Promise<boolean>;

  /**
   * Atomically set a key to `newValue` only if its current value exactly
   * equals `expectedValue`. Used for compare-and-swap completion of
   * idempotency reservations.
   *
   * Redis: Lua script for atomicity.  Memory: single-threaded, safe as-is.
   * @returns `true` if the key existed with the expected value and was updated.
   */
  compareAndSet(
    key: string,
    expectedValue: string,
    newValue: string,
    opts?: SetOptions,
  ): Promise<boolean>;

  /** Ping the store. Returns true when reachable. */
  ping(): Promise<boolean>;

  /** Close all connections. */
  close(): Promise<void>;
}
