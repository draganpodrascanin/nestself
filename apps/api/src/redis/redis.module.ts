/**
 * Global NestJS module providing the {@link KeyValueStore} abstraction.
 *
 * - When `REDIS_URL` is set: uses {@link RedisKeyValueStore}.
 * - When absent and `AUTH_MODE=stub` or `NODE_ENV=test`: uses {@link MemoryKeyValueStore}.
 * - Otherwise startup fails with a clear message.
 *
 * @see D-26, D-36
 */
import {
  Global,
  Module,
  type OnModuleDestroy,
  Inject,
  Logger,
} from '@nestjs/common';
 
import { ConfigService } from '@nestjs/config';
import { KEY_VALUE_STORE, type KeyValueStore } from './key-value-store.js';
import { RedisKeyValueStore } from './redis-key-value-store.js';
import { MemoryKeyValueStore } from './memory-key-value-store.js';
import { RedisHealthIndicator } from './redis-health.indicator.js';

@Global()
@Module({
  providers: [
    {
      provide: KEY_VALUE_STORE,
      useFactory: async (config: ConfigService): Promise<KeyValueStore> => {
        const logger = new Logger('RedisModule');
        const redisUrl = config.get<string>('REDIS_URL');
        const authMode = config.get<string>('AUTH_MODE') ?? 'stub';
        const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';

        if (redisUrl) {
          const store = new RedisKeyValueStore(redisUrl);
          await store.connect();
          logger.log('Connected to Redis');
          return store;
        }

        if (authMode === 'stub' || nodeEnv === 'test') {
          logger.warn(
            'REDIS_URL not set; using in-memory key-value store (not for production)',
          );
          return new MemoryKeyValueStore();
        }

        throw new Error(
          'REDIS_URL is required when AUTH_MODE is not "stub". ' +
            'Set REDIS_URL or use AUTH_MODE=stub for local development.',
        );
      },
      inject: [ConfigService],
    },
    RedisHealthIndicator,
  ],
  exports: [KEY_VALUE_STORE, RedisHealthIndicator],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.store.close();
  }
}
