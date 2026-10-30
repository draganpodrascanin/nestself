/**
 * Run one maintenance job once and exit (no queue): useful locally, for a
 * one-off ECS task, or to verify a job after a deploy.
 *
 * Lives under `src/` so that `nest build` compiles it with decorator
 * metadata (Nest resolves constructor dependencies from it; `tsx` emits
 * none). `job:run` builds, then runs `node dist/worker/run-job.js <name>`.
 *
 *   pnpm --filter @nestself/api job:run audit.ensure-partitions
 *   pnpm --filter @nestself/api job:run grants.reconcile
 *   pnpm --filter @nestself/api job:run mobile.prune-stale-families
 *   pnpm --filter @nestself/api job:run sso.certificate-expiry
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import {
  MAINTENANCE_JOB_NAMES,
  MaintenanceJobsService,
  isMaintenanceJobName,
  type MaintenanceJobName,
} from '../jobs/maintenance-jobs.service.js';

const name = process.argv[2];
if (!name || !isMaintenanceJobName(name)) {
  console.error(`usage: job:run <${MAINTENANCE_JOB_NAMES.join('|')}>`);
  process.exit(1);
}

async function run(jobName: MaintenanceJobName): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const report = await app.get(MaintenanceJobsService).run(jobName);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}

run(name).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
