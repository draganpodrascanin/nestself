/**
 * WebinarJobSchedulerService: the `nestself-webinars` BullMQ queue of the
 * webinar module (T-CW-2.1, guidelines 9).
 *
 * Deviation from guidelines 9, which put the webinar jobs on the
 * `nestself-calls` queue: that queue's producer and consumer
 * (`CallsJobSchedulerService`, `CallsJobsService`) were being changed by
 * another task when this one landed, so the webinar jobs run on their own
 * queue with the same structure. Merging the two later only moves the job
 * names.
 *
 * - Producer (API and worker): delayed jobs with a deterministic `jobId`, so
 *   scheduling twice is a no-op and removal finds the job by id. The queue
 *   and its Redis connection open on first use; without `REDIS_URL` every
 *   call is a logged no-op (tests, stub mode).
 *   - `webinar.remind` per registration at each `REMINDER_OFFSETS_MINUTES`
 *     offset still in the future (WBN-05, D-CW-26); removed on
 *     unregistration and cancellation (CW-R-37a).
 *   - `webinar.recording.start` at once when a host starts the webinar
 *     (CW-R-107, CW-R-121).
 *   - `webinar.recording.finalize` at once when recording stops (T-CW-2.5).
 * - Consumer (worker only, {@link start}): the `Worker` that hands every job
 *   to the {@link WebinarJobHandler} (`WebinarJobsService`).
 *
 * Job ids join the job name and the entity ids with `/` (BullMQ 6 refuses
 * most custom ids with `:`). `prefix` is the BullMQ key prefix; tests set a
 * run-specific one on the shared Redis.
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { REMINDER_OFFSETS_MINUTES } from '@nestself/contracts';

export const WEBINARS_QUEUE = 'nestself-webinars';

export const WEBINAR_JOB_NAMES = ['webinar.remind', 'webinar.recording.start', 'webinar.recording.finalize'] as const;
export type WebinarJobName = (typeof WEBINAR_JOB_NAMES)[number];

export function isWebinarJobName(name: string): name is WebinarJobName {
  return (WEBINAR_JOB_NAMES as readonly string[]).includes(name);
}

/** Every job carries the ids it needs to re-read the current state (CW-R-37). */
export interface WebinarJobData {
  'webinar.remind': { webinarId: string; registrationId: string; offsetMinutes: number };
  /** The session is null when no host has joined yet; the recording job looks it up when it runs. */
  'webinar.recording.start': { webinarId: string; sessionId: string | null };
  'webinar.recording.finalize': { webinarId: string; sessionId: string };
}

/** Runs one job of the queue; implemented by `WebinarJobsService`. */
export interface WebinarJobHandler {
  handle<N extends WebinarJobName>(name: N, data: WebinarJobData[N]): Promise<unknown>;
}

const MINUTE_MS = 60_000;

/** The reminder offsets still in the future and their delays (CW-R-46). */
export function webinarReminderSchedule(startsAt: Date, now: Date): { offsetMinutes: number; delayMs: number }[] {
  return REMINDER_OFFSETS_MINUTES.map((offsetMinutes) => ({
    offsetMinutes,
    delayMs: startsAt.getTime() - offsetMinutes * MINUTE_MS - now.getTime(),
  })).filter((entry) => entry.delayMs > 0);
}

/** Deterministic job id: the job name and the entity ids, joined with `/`. */
export function webinarJobId(name: WebinarJobName, ...parts: (string | number)[]): string {
  return [name, ...parts].join('/');
}

/** The ids of a registration's reminder jobs, one per offset. */
export function webinarReminderJobIds(registrationId: string): string[] {
  return REMINDER_OFFSETS_MINUTES.map((offset) => webinarJobId('webinar.remind', registrationId, offset));
}

/** Retried with backoff, kept a day after success for inspection. */
const JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class WebinarJobSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(WebinarJobSchedulerService.name);
  private producerConnection: Redis | null = null;
  private workerConnection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private warnedNoRedis = false;

  /** BullMQ key prefix (BullMQ's default). Tests set a run-specific one before first use. */
  prefix = 'bull';

  constructor(private readonly config: ConfigService) {}

  // ── Consumer (worker process) ─────────────────────────────────────────────

  /** Starts processing with `handler`. False (and logged) without `REDIS_URL`. */
  async start(handler: WebinarJobHandler): Promise<boolean> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set; the webinar job scheduler is disabled');
      return false;
    }
    this.workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      WEBINARS_QUEUE,
      async (job: Job) => {
        if (!isWebinarJobName(job.name)) throw new Error(`Unknown webinar job: ${job.name}`);
        return handler.handle(job.name, job.data as WebinarJobData[typeof job.name]);
      },
      { connection: this.workerConnection, prefix: this.prefix, concurrency: 4 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error({ job: job?.name, jobId: job?.id, error: error.name }, 'Webinar job failed'),
    );
    this.worker.on('error', (error) => this.logger.error({ error: error.name }, 'Webinar worker error'));
    this.logger.log(`webinar job scheduler started (queue ${WEBINARS_QUEUE})`);
    return true;
  }

  // ── Producer ──────────────────────────────────────────────────────────────

  /** One `webinar.remind` per offset still in the future (WBN-05). The number scheduled; 0 without Redis. */
  async scheduleReminders(
    registration: { id: string; webinarId: string },
    startsAt: Date,
    now: Date = new Date(),
  ): Promise<number> {
    let scheduled = 0;
    for (const { offsetMinutes, delayMs } of webinarReminderSchedule(startsAt, now)) {
      const added = await this.add(
        'webinar.remind',
        { webinarId: registration.webinarId, registrationId: registration.id, offsetMinutes },
        webinarJobId('webinar.remind', registration.id, offsetMinutes),
        delayMs,
      );
      if (added) scheduled += 1;
    }
    return scheduled;
  }

  /** Removes a registration's pending reminders (unregistration, cancellation, CW-R-37a). */
  async cancelReminders(registrationId: string): Promise<void> {
    const queue = this.ensureQueue();
    if (!queue) return;
    for (const id of webinarReminderJobIds(registrationId)) await queue.remove(id);
  }

  /** `webinar.recording.start`, at once (CW-R-107). False without Redis. */
  async enqueueRecordingStart(webinarId: string, sessionId: string | null): Promise<boolean> {
    return this.add(
      'webinar.recording.start',
      { webinarId, sessionId },
      webinarJobId('webinar.recording.start', webinarId),
      0,
    );
  }

  /** `webinar.recording.finalize`, at once, once per session (T-CW-2.5). False without Redis. */
  async enqueueRecordingFinalize(webinarId: string, sessionId: string): Promise<boolean> {
    return this.add(
      'webinar.recording.finalize',
      { webinarId, sessionId },
      webinarJobId('webinar.recording.finalize', sessionId),
      0,
    );
  }

  /** The queue, for tests and inspection. Null without Redis. */
  getQueue(): Queue | null {
    return this.ensureQueue();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.workerConnection?.disconnect();
    this.producerConnection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.workerConnection = null;
    this.producerConnection = null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async add<N extends WebinarJobName>(
    name: N,
    data: WebinarJobData[N],
    jobId: string,
    delayMs: number,
  ): Promise<boolean> {
    const queue = this.ensureQueue();
    if (!queue) return false;
    try {
      await queue.add(name, data, { ...JOB_OPTIONS, jobId, delay: Math.max(0, Math.round(delayMs)) });
    } catch (error) {
      this.logger.error({ job: name, jobId, error: errorName(error) }, 'Webinar job not scheduled');
      throw error;
    }
    this.logger.debug({ job: name, jobId, delayMs }, 'Webinar job scheduled');
    return true;
  }

  private ensureQueue(): Queue | null {
    if (this.queue) return this.queue;
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      if (!this.warnedNoRedis) {
        this.logger.debug('REDIS_URL not set; webinar jobs are not scheduled');
        this.warnedNoRedis = true;
      }
      return null;
    }
    this.producerConnection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    this.queue = new Queue(WEBINARS_QUEUE, { connection: this.producerConnection, prefix: this.prefix });
    return this.queue;
  }
}
