/**
 * InvalidationSubscriber — subscribes to the Redis `invalidate` channel
 * at startup and deletes listed keys locally + purges LRU.
 *
 * @see AUTH-R-11, AUTHZ-R-44
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import { INVALIDATE_CHANNEL } from '../redis/redis-keys.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CacheGateway } from './cache-gateway.js';

@Injectable()
export class InvalidationSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvalidationSubscriber.name);
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    private readonly cache: CacheGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.store.subscribe(
        INVALIDATE_CHANNEL,
        (message) => this.handleMessage(message),
      );
      this.logger.log('Subscribed to invalidation channel');
    } catch (err) {
      this.logger.warn(`Failed to subscribe to invalidation channel: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.unsubscribe) {
      await this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleMessage(message: string): void {
    try {
      const data = JSON.parse(message) as { keys?: string[]; userId?: string };
      if (Array.isArray(data.keys)) {
        for (const key of data.keys) {
          this.cache.del(key).catch(() => {});
        }
      }
      if (data.userId) {
        this.cache.purgeLru(`principal:${data.userId}`);
        this.cache.purgeLru(`grants:${data.userId}`);
        this.cache.purgeLru(`assignments:${data.userId}`);
      }
    } catch {
      this.logger.warn('Failed to parse invalidation message');
    }
  }
}
