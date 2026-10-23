/**
 * JobsModule — background work.
 *
 * - `JobAuthorization` wraps BullMQ processors that act on behalf of a
 *   principal so the job re-authorizes against the principal's current state
 *   (T-1.17, AUTHZ-R-53).
 * - `MaintenanceJobsService` holds the nightly system jobs (audit partitions,
 *   grant reconciliation, stale mobile families).
 * - `JobSchedulerService` registers the schedules and processes the queue; it
 *   is started only by the worker process (`src/worker/main.ts`).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JobAuthorization } from './job-authorization.js';
import { MaintenanceJobsService } from './maintenance-jobs.service.js';
import { JobSchedulerService } from './job-scheduler.service.js';

@Module({
  imports: [AuthModule],
  providers: [JobAuthorization, MaintenanceJobsService, JobSchedulerService],
  exports: [JobAuthorization, MaintenanceJobsService, JobSchedulerService],
})
export class JobsModule {}
