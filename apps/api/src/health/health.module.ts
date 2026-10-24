import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { DbHealthIndicator } from './db.health.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [TerminusModule, RedisModule],
  controllers: [HealthController],
  providers: [DbHealthIndicator],
})
export class HealthModule {}
