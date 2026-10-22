/**
 * PrincipalModule — provides PrincipalLoader and related services.
 *
 * @see T-1.7
 */
import { Global, Module } from '@nestjs/common';
import { PrincipalLoader } from './principal-loader.js';
import { CacheGateway } from './cache-gateway.js';
import { InvalidationSubscriber } from './invalidation-subscriber.js';

@Global()
@Module({
  providers: [PrincipalLoader, CacheGateway, InvalidationSubscriber],
  exports: [PrincipalLoader, CacheGateway],
})
export class PrincipalModule {}
