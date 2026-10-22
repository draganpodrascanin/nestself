import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { HealthIndicatorService } from '@nestjs/terminus';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';

@Injectable()
export class DbHealthIndicator {
  constructor(
    private readonly dbs: DbService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string) {
    return this.healthIndicatorService.check(key).attempt(async () => {
      await this.dbs.ping();
    });
  }
}
