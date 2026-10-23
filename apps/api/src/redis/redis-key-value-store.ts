/**
 * Redis (node-redis) KeyValueStore implementation.
 *
 * Uses one client for commands and a lazily-created duplicate for subscriptions.
 * All Redis errors are surfaced as {@link RedisUnavailableError}.
 *
 * @see D-26
 */
import { createClient, type RedisClientType } from 'redis';
import type { KeyValueStore, SetOptions } from './key-value-store.js';

/** Thrown when a Redis command fails or the connection is lost. */
export class RedisUnavailableError extends Error {
  override readonly name = 'RedisUnavailableError';
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

type Client = RedisClientType<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

export class RedisKeyValueStore implements KeyValueStore {
  private readonly client: Client;
  private subscriber: Client | null = null;

  constructor(url: string) {
    this.client = createClient({ url }) as Client;
    this.client.on('error', () => {
      /* reconnect is automatic; errors logged by the client */
    });
  }

  /** Connect the command client. Must be called before any operation. */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      throw new RedisUnavailableError('Failed to connect to Redis', err);
    }
  }

  // -- helpers --------------------------------------------------------------

  private wrap<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((err: unknown) => {
      throw new RedisUnavailableError('Redis command failed', err);
    });
  }

  private async ensureSubscriber(): Promise<Client> {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate() as Client;
      this.subscriber.on('error', () => {});
      await this.subscriber.connect();
    }
    return this.subscriber;
  }

  // -- KeyValueStore --------------------------------------------------------

  async get(key: string): Promise<string | null> {
    return this.wrap(this.client.get(key));
  }

  async set(key: string, value: string, opts?: SetOptions): Promise<boolean> {
    const redisOpts: Record<string, unknown> = {};
    if (opts?.ttlSeconds != null) {
      redisOpts.EX = opts.ttlSeconds;
    }
    if (opts?.onlyIfAbsent) {
      redisOpts.NX = true;
    }
    const result = await this.wrap(
      this.client.set(key, value, redisOpts),
    );
    // node-redis returns null when NX is set and the key exists
    return result !== null;
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.wrap(this.client.del(keys));
  }

  async getDel(key: string): Promise<string | null> {
    return this.wrap(this.client.getDel(key));
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.wrap(this.client.expire(key, ttlSeconds));
    return Boolean(result);
  }

  async ttl(key: string): Promise<number> {
    return this.wrap(this.client.ttl(key));
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const val = await this.wrap(this.client.incr(key));
    if (val === 1 && ttlSeconds != null) {
      await this.wrap(this.client.expire(key, ttlSeconds));
    }
    return val;
  }

  async sAdd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.wrap(this.client.sAdd(key, members));
  }

  async sRem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.wrap(this.client.sRem(key, members));
  }

  async sMembers(key: string): Promise<string[]> {
    return this.wrap(this.client.sMembers(key));
  }

  async scan(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    try {
      for await (const batch of this.client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
        // node-redis v5 yields string[] batches; v4 yielded single keys.
        if (Array.isArray(batch)) keys.push(...batch);
        else keys.push(batch as unknown as string);
      }
    } catch (err) {
      throw new RedisUnavailableError('Redis command failed', err);
    }
    return keys;
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.wrap(this.client.publish(channel, message));
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void,
  ): Promise<() => Promise<void>> {
    const sub = await this.ensureSubscriber();
    await this.wrap(sub.subscribe(channel, handler));

    return async () => {
      await sub.unsubscribe(channel).catch(() => {});
    };
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.subscriber) {
        await this.subscriber.quit().catch(() => {});
        this.subscriber = null;
      }
      await this.client.quit().catch(() => {});
    } catch {
      // best effort
    }
  }
}
