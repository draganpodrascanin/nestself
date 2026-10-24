/**
 * CallsJobSchedulerService: the `nestself-calls` BullMQ queue of the
 * consultations epic (T-CW-1.2, guidelines 9, CW-R-37a), separate from the
 * `nestself-maintenance` queue of `JobSchedulerService` so a slow call job
 * never holds up a nightly one.
 *
 * Two halves:
 * - Producer (API and worker): per-entity delayed jobs with a deterministic
 *   `jobId`, so scheduling twice is a no-op and a cancellation removes the
 *   job by id. The queue and its Redis connection open on first use; without
 *   `REDIS_URL` every call is a logged no-op (tests, stub mode).
 *   - `calls.cleanup` at `endsAt + CALL_ROOM_CLOSE_AFTER_MINUTES` per session
 *     (D-CW-09). The join path does not schedule it: the event applier does
 *     when the provider's `MeetingStarted` arrives, and `calls.reconcile`
 *     schedules it for any ACTIVE session whose event never came.
 *   - `appointment.remind` at each `REMINDER_OFFSETS_MINUTES` offset still in
 *     the future, from `AppointmentsService` on creation; removed on cancel
 *     (D-CW-26, CW-R-46).
 *   - `appointment.approval.remind` and `appointment.approval.expire` per
 *     follow-up approval item, five and ten working days after the request
 *     (T-CW-1.10, CALL-40; `ApprovalService` computes the instants); removed
 *     once the item is decided.
 *   - `calls.no_show_followup` 48 hours after the appointment's `endsAt`
 *     (at once when that has passed), when the outcome path records
 *     `no_show_employee` ({@link scheduleNoShowFollowUp}). The scheduler reads
 *     the appointment's end itself, straight from `appointments`: it cannot
 *     depend on `AppointmentsModule`, which imports it.
 * - Consumer (worker only, {@link start}): the 5-minute `calls.reconcile`
 *   job scheduler (`upsertJobScheduler`, `JOBS_TIMEZONE`, default
 *   Europe/Belgrade) and the `Worker` that hands every job to the
 *   {@link CallsJobHandler} (`CallsJobsService`).
 *
 * Job ids join the job name and the entity ids with `/`: the decision
 * record's `appointment.remind:{appointmentId}:{offset}` cannot be used as
 * is, because BullMQ 6 refuses a custom id with `:` unless it has exactly
 * three segments (`calls.cleanup:{sessionId}` would throw) and marks even
 * that exception for removal.
 *
 * BullMQ needs its own ioredis connections: the worker's with
 * `maxRetriesPerRequest: null`, the producer's failing fast so an API request
 * never waits on a Redis outage. `prefix` is the BullMQ key prefix; tests set
 * their own so they never take another run's jobs on a shared Redis.
 *
 * @see D-CW-09, D-CW-26, guidelines 4.4, 9 and 10.3
 */
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { CALL_ROOM_CLOSE_AFTER_MINUTES, REMINDER_OFFSETS_MINUTES } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { appointments } from '../db/schema/index.js';

export const CALLS_QUEUE = 'nestself-calls';

export const CALLS_JOB_NAMES = [
  'calls.cleanup',
  'calls.reconcile',
  'appointment.remind',
  'calls.no_show_followup',
  'appointment.approval.remind',
  'appointment.approval.expire',
] as const;
export type CallsJobName = (typeof CALLS_JOB_NAMES)[number];

export function isCallsJobName(name: string): name is CallsJobName {
  return (CALLS_JOB_NAMES as readonly string[]).includes(name);
}

export type ReminderRecipient = 'employee' | 'expert';

/** Who an approval reminder goes to (CALL-40). */
export type ApprovalReminderRecipient = 'approver' | 'alternate';

/** Every delayed job carries the ids it needs to re-read the current state (CW-R-37). */
export interface CallsJobData {
  'calls.cleanup': { sessionId: string; appointmentId: string | null };
  'calls.reconcile': Record<string, never>;
  /** `sentTo` records who already got the email, so a retry does not send it twice. */
  'appointment.remind': { appointmentId: string; offsetMinutes: number; sentTo?: ReminderRecipient[] };
  'calls.no_show_followup': { appointmentId: string };
  /** `sentTo` as for `appointment.remind`. */
  'appointment.approval.remind': { approvalId: string; sentTo?: ApprovalReminderRecipient[] };
  'appointment.approval.expire': { approvalId: string };
}

export interface CallsJobContext<N extends CallsJobName = CallsJobName> {
  /** Persists the job's data, for progress a retry must see. */
  updateData(data: CallsJobData[N]): Promise<void>;
}

/** Runs one job of the queue; implemented by `CallsJobsService`. */
export interface CallsJobHandler {
  handle<N extends CallsJobName>(name: N, data: CallsJobData[N], context: CallsJobContext<N>): Promise<unknown>;
}

/** Every 5 minutes (D-CW-09, CW-R-38). */
export const CALLS_RECONCILE_PATTERN = '*/5 * * * *';

/** `calls.no_show_followup` runs 48 hours after the appointment ends (CALL-07, guidelines 9). */
export const NO_SHOW_FOLLOW_UP_DELAY_MS = 48 * 60 * 60_000;

const MINUTE_MS = 60_000;

/** When the room closes: `endsAt + CALL_ROOM_CLOSE_AFTER_MINUTES` (D-CW-09). */
export function roomClosesAt(endsAt: Date): Date {
  return new Date(endsAt.getTime() + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE_MS);
}

/** Delay of `calls.cleanup`: until the room closes, at least 0. */
export function cleanupDelayMs(endsAt: Date, now: Date): number {
  return Math.max(0, roomClosesAt(endsAt).getTime() - now.getTime());
}

/** The reminder offsets still in the future and their delays (CW-R-46). */
export function reminderSchedule(startsAt: Date, now: Date): { offsetMinutes: number; delayMs: number }[] {
  return REMINDER_OFFSETS_MINUTES.map((offsetMinutes) => ({
    offsetMinutes,
    delayMs: startsAt.getTime() - offsetMinutes * MINUTE_MS - now.getTime(),
  })).filter((entry) => entry.delayMs > 0);
}

/** Delay of `calls.no_show_followup`: until `endsAt + 48 hours`, at least 0. */
export function noShowFollowUpDelayMs(endsAt: Date, now: Date): number {
  return Math.max(0, endsAt.getTime() + NO_SHOW_FOLLOW_UP_DELAY_MS - now.getTime());
}

/** Deterministic job id: the job name and the entity ids, joined with `/`. */
export function callsJobId(name: CallsJobName, ...parts: (string | number)[]): string {
  return [name, ...parts].join('/');
}

/** Options of every delayed job: retried with backoff, kept a day after success for inspection. */
const DELAYED_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class CallsJobSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(CallsJobSchedulerService.name);
  private producerConnection: Redis | null = null;
  private workerConnection: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private warnedNoRedis = false;

  /** BullMQ key prefix (BullMQ's default). Tests set a run-specific one before first use. */
  prefix = 'bull';

  constructor(
    private readonly config: ConfigService,
    private readonly dbs: DbService,
  ) {}

  // ── Consumer (worker process) ─────────────────────────────────────────────

  /**
   * Registers `calls.reconcile` and starts processing with `handler`. False
   * (and logged) without `REDIS_URL`.
   */
  async start(handler: CallsJobHandler): Promise<boolean> {
    const redisUrl = this.config.get<string>('REDIS_URL');
    const queue = this.ensureQueue();
    if (!redisUrl || !queue) {
      this.logger.warn('REDIS_URL not set; the calls job scheduler is disabled');
      return false;
    }
    const timezone = this.config.get<string>('JOBS_TIMEZONE') ?? 'Europe/Belgrade';
    await queue.upsertJobScheduler(
      'calls.reconcile',
      { pattern: CALLS_RECONCILE_PATTERN, tz: timezone },
      {
        name: 'calls.reconcile',
        data: {},
        opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
      },
    );

    this.workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      CALLS_QUEUE,
      async (job: Job) => {
        if (!isCallsJobName(job.name)) throw new Error(`Unknown calls job: ${job.name}`);
        return handler.handle(job.name, job.data as CallsJobData[typeof job.name], {
          updateData: (data) => job.updateData(data),
        });
      },
      { connection: this.workerConnection, prefix: this.prefix, concurrency: 4 },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.error({ job: job?.name, jobId: job?.id, error: error.name }, 'Calls job failed'),
    );
    this.worker.on('error', (error) => this.logger.error({ error: error.name }, 'Calls worker error'));
    this.logger.log(`calls job scheduler started (queue ${CALLS_QUEUE}, timezone ${timezone})`);
    return true;
  }

  // ── Producer ──────────────────────────────────────────────────────────────

  /** `calls.cleanup` for the session when its room closes. False without Redis. */
  async scheduleCleanup(
    session: { id: string; endsAt: Date; appointmentId: string | null },
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.add(
      'calls.cleanup',
      { sessionId: session.id, appointmentId: session.appointmentId },
      callsJobId('calls.cleanup', session.id),
      cleanupDelayMs(session.endsAt, now),
    );
  }

  /**
   * One `appointment.remind` per offset still in the future (D-CW-26). The
   * number scheduled; 0 without Redis.
   */
  async scheduleReminders(appointment: { id: string; startsAt: Date }, now: Date = new Date()): Promise<number> {
    let scheduled = 0;
    for (const { offsetMinutes, delayMs } of reminderSchedule(appointment.startsAt, now)) {
      const added = await this.add(
        'appointment.remind',
        { appointmentId: appointment.id, offsetMinutes },
        callsJobId('appointment.remind', appointment.id, offsetMinutes),
        delayMs,
      );
      if (added) scheduled += 1;
    }
    return scheduled;
  }

  /**
   * `calls.no_show_followup` 48 hours after the appointment's end. The outcome
   * path calls it when the expert records `no_show_employee` (CALL-07). False
   * without Redis or when the appointment does not exist.
   */
  async scheduleNoShowFollowUp(appointmentId: string, now: Date = new Date()): Promise<boolean> {
    if (!this.ensureQueue()) return false;
    const [appointment] = await this.dbs.db
      .select({ endsAt: appointments.endsAt })
      .from(appointments)
      .where(eq(appointments.id, appointmentId));
    if (!appointment) {
      this.logger.warn({ appointmentId, operation: 'scheduleNoShowFollowUp' }, 'No such appointment; no follow-up scheduled');
      return false;
    }
    return this.add(
      'calls.no_show_followup',
      { appointmentId },
      callsJobId('calls.no_show_followup', appointmentId),
      noShowFollowUpDelayMs(appointment.endsAt, now),
    );
  }

  /** Removes the appointment's pending reminder and follow-up jobs (cancellation, CW-R-37a). */
  async cancelAppointmentJobs(appointmentId: string): Promise<void> {
    const queue = this.ensureQueue();
    if (!queue) return;
    const ids = [
      ...REMINDER_OFFSETS_MINUTES.map((offset) => callsJobId('appointment.remind', appointmentId, offset)),
      callsJobId('calls.no_show_followup', appointmentId),
    ];
    for (const id of ids) await queue.remove(id);
  }

  /**
   * `appointment.approval.remind` at `remindAt` and `appointment.approval.expire`
   * at `expireAt` for one approval item (T-CW-1.10). False without Redis.
   */
  async scheduleApprovalJobs(
    approvalId: string,
    at: { remindAt: Date; expireAt: Date },
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!this.ensureQueue()) return false;
    await this.add(
      'appointment.approval.remind',
      { approvalId },
      callsJobId('appointment.approval.remind', approvalId),
      at.remindAt.getTime() - now.getTime(),
    );
    await this.add(
      'appointment.approval.expire',
      { approvalId },
      callsJobId('appointment.approval.expire', approvalId),
      at.expireAt.getTime() - now.getTime(),
    );
    return true;
  }

  /** Removes a decided approval item's reminder and expiry jobs. */
  async cancelApprovalJobs(approvalId: string): Promise<void> {
    const queue = this.ensureQueue();
    if (!queue) return;
    await queue.remove(callsJobId('appointment.approval.remind', approvalId));
    await queue.remove(callsJobId('appointment.approval.expire', approvalId));
  }

  /** The queue, for tests and the worker's own inspection. Null without Redis. */
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

  private async add<N extends CallsJobName>(
    name: N,
    data: CallsJobData[N],
    jobId: string,
    delayMs: number,
  ): Promise<boolean> {
    const queue = this.ensureQueue();
    if (!queue) return false;
    try {
      await queue.add(name, data, { ...DELAYED_JOB_OPTIONS, jobId, delay: Math.max(0, Math.round(delayMs)) });
    } catch (error) {
      this.logger.error({ job: name, jobId, error: errorName(error) }, 'Calls job not scheduled');
      throw error;
    }
    this.logger.debug({ job: name, jobId, delayMs }, 'Calls job scheduled');
    return true;
  }

  private ensureQueue(): Queue | null {
    if (this.queue) return this.queue;
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      if (!this.warnedNoRedis) {
        this.logger.debug('REDIS_URL not set; calls jobs are not scheduled');
        this.warnedNoRedis = true;
      }
      return null;
    }
    this.producerConnection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    this.queue = new Queue(CALLS_QUEUE, { connection: this.producerConnection, prefix: this.prefix });
    return this.queue;
  }
}
