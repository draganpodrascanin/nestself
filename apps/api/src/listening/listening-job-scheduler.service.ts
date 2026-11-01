/**
 * ListeningJobSchedulerService: the `nestself-listening` BullMQ queue (spec
 * section 12), separate from the maintenance and calls queues so a slow
 * finalization never holds up a reminder or a nightly job. Worker process
 * only (`src/worker/main.ts`): two repeatable schedulers, `listening.tick`
 * every 5 minutes and `listening.remind` hourly, both handed to
 * `ListeningJobsService`. Without `REDIS_URL` it is disabled and logged.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { isListeningJobName, type ListeningJobName, type ListeningJobReport } from './listening-jobs.service.js';

export const LISTENING_QUEUE = 'nestself-listening';

export const LISTENING_SCHEDULES: Record<ListeningJobName, string> = {
  'listening.tick': '*/5 * * * *',
  'listening.remind': '0 * * * *',
};

export interface ListeningJobHandler {
  run(name: ListeningJobName, now?: Date): Promise<ListeningJobReport>;
}

@Injectable()
export class ListeningJobSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(ListeningJobSchedulerService.name);
  private connection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  /** BullMQ key prefix; tests set a run-specific one before `start`. */
  prefix = 'bull';

  constructor(private readonly config: ConfigService) {}

  async start(handler: ListeningJobHandler): Promise<boolean> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set; the listening job scheduler is disabled');
      return false;
    }
    const timezone = this.config.get<string>('JOBS_TIMEZONE') ?? 'Europe/Belgrade';
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(LISTENING_QUEUE, { connection: this.connection, prefix: this.prefix });
    for (const name of Object.keys(LISTENING_SCHEDULES) as ListeningJobName[]) {
      await this.queue.upsertJobScheduler(
        name,
        { pattern: LISTENING_SCHEDULES[name], tz: timezone },
        {
          name,
          data: {},
          opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 }, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
        },
      );
    }
    this.worker = new Worker(
      LISTENING_QUEUE,
      async (job: Job): Promise<ListeningJobReport> => {
        if (!isListeningJobName(job.name)) throw new Error(`Unknown listening job: ${job.name}`);
        return handler.run(job.name);
      },
      { connection: this.connection, prefix: this.prefix, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => this.logger.error({ job: job?.name, jobId: job?.id, error: error.name }, 'Listening job failed'));
    this.worker.on('error', (error) => this.logger.error({ error: error.name }, 'Listening worker error'));
    this.logger.log(`listening job scheduler started (queue ${LISTENING_QUEUE}, timezone ${timezone})`);
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }
}
