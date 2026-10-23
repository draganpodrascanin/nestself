/**
 * Run one maintenance job once and exit (no queue): useful locally, for a
 * one-off ECS task, or to verify a job after a deploy.
 *
 *   pnpm --filter @nestself/api job:run audit.ensure-partitions
 *   pnpm --filter @nestself/api job:run grants.reconcile
 *   pnpm --filter @nestself/api job:run mobile.prune-stale-families
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import {
  MAINTENANCE_JOB_NAMES,
  MaintenanceJobsService,
  isMaintenanceJobName,
} from '../src/jobs/maintenance-jobs.service.js';

const name = process.argv[2];
if (!name || !isMaintenanceJobName(name)) {
  console.error(`usage: run-job.ts <${MAINTENANCE_JOB_NAMES.join('|')}>`);
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
try {
  const report = await app.get(MaintenanceJobsService).run(name);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
