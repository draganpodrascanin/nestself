import { Controller, Get } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { HealthCheckService, HealthCheck } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbHealthIndicator } from './db.health.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RedisHealthIndicator } from '../redis/redis-health.indicator.js';

/**
 * Health checks are polled by the load balancer and the container runtime,
 * which come from a few addresses at a fixed rate: under the default budget
 * (60 a minute per client IP) a busy poller would be answered 429 and take a
 * healthy task out of service, so the controller is not throttled.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dbHealth: DbHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.dbHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }
}
