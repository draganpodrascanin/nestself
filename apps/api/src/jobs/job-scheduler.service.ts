/**
 * JobSchedulerService — BullMQ wiring for the maintenance jobs.
 *
 * Runs only in the worker process (`src/worker/main.ts`), never in the API:
 * `start()` registers one repeatable job scheduler per maintenance job and a
 * worker that executes them through `MaintenanceJobsService`. BullMQ needs its
 * own ioredis connection (`maxRetriesPerRequest: null`), separate from the
 * node-redis `KeyValueStore`. Schedules are cron expressions in UTC;
 * `JOBS_TIMEZONE` moves them to the platform's local night.
 *
 * @see 4.6.4, D-21, T-1.17, T-2.10
 */
import { Inject, Injectable, Logger, forwardRef, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

import {
  MAINTENANCE_JOB_NAMES,
  MaintenanceJobsService,
  isMaintenanceJobName,
  type MaintenanceJobName,
  type MaintenanceReport,
} from './maintenance-jobs.service.js';

export const MAINTENANCE_QUEUE = 'nestself-maintenance';

/** Default cron patterns: nightly jobs at local night, the emergency sweeper every 15 minutes (4.7). */
export const MAINTENANCE_SCHEDULES: Record<MaintenanceJobName, string> = {
  'audit.ensure-partitions': '0 1 * * *',
  'grants.reconcile': '15 2 * * *',
  'mobile.prune-stale-families': '30 2 * * *',
  'emergency.sweep-expired': '*/15 * * * *',
};

@Injectable()
export class JobSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulerService.name);
  private connection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(forwardRef(() => ConfigService)) private readonly config: ConfigService,
    @Inject(forwardRef(() => MaintenanceJobsService)) private readonly jobs: MaintenanceJobsService,
  ) {}

  /**
   * Register the schedulers and start processing. Returns false (and logs)
   * when `REDIS_URL` is absent: there is no queue without Redis.
   */
  async start(): Promise<boolean> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set; the maintenance scheduler is disabled');
      return false;
    }
    const timezone = this.config.get<string>('JOBS_TIMEZONE') ?? 'Europe/Belgrade';

    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });

    for (const name of MAINTENANCE_JOB_NAMES) {
      await this.queue.upsertJobScheduler(
        name,
        { pattern: MAINTENANCE_SCHEDULES[name], tz: timezone },
        {
          name,
          opts: {
            removeOnComplete: { count: 30 },
            removeOnFail: { count: 100 },
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
          },
        },
      );
    }

    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job: Job): Promise<MaintenanceReport> => {
        if (!isMaintenanceJobName(job.name)) {
          throw new Error(`Unknown maintenance job: ${job.name}`);
        }
        return this.jobs.run(job.name);
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('completed', (job) => this.logger.log(`job ${job.name} (${job.id}) completed`));
    this.worker.on('failed', (job, err) =>
      this.logger.error(`job ${job?.name} (${job?.id}) failed: ${err.message}`),
    );

    this.logger.log(
      `maintenance scheduler started (${MAINTENANCE_JOB_NAMES.length} jobs, timezone ${timezone})`,
    );
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
    this.connection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }
}
