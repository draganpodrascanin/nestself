/**
 * WebinarJobSchedulerService (T-CW-2.1): queue and job names, job ids
 * without colons, the reminder offsets (WBN-05, CW-R-46), removal by id
 * (CW-R-37a), the no-Redis behaviour, and a BullMQ round trip on the shared
 * Redis under a run-specific prefix (skipped when Redis does not answer).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REMINDER_OFFSETS_MINUTES } from '@nestself/contracts';
import {
  WEBINARS_QUEUE,
  WEBINAR_JOB_NAMES,
  WebinarJobDelay,
  WebinarJobSchedulerService,
  isWebinarJobName,
  webinarJobContext,
  webinarJobId,
  webinarReminderJobIds,
  webinarReminderSchedule,
  type WebinarJobContext,
  type WebinarJobData,
  type WebinarJobName,
} from './webinar-job-scheduler.service.js';

const MINUTE = 60_000;
const NOW = new Date('2026-11-10T12:00:00.000Z');
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

function config(redisUrl?: string): ConfigService {
  return { get: (key: string) => (key === 'REDIS_URL' ? redisUrl : undefined) } as unknown as ConfigService;
}

async function redisAnswers(url: string): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1_000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

describe('webinar job rules', () => {
  it('uses its own queue and the canonical job names', () => {
    expect(WEBINARS_QUEUE).toBe('nestself-webinars');
    expect([...WEBINAR_JOB_NAMES].sort()).toEqual(['webinar.recording.finalize', 'webinar.recording.start', 'webinar.remind']);
    expect(isWebinarJobName('webinar.remind')).toBe(true);
    expect(isWebinarJobName('appointment.remind')).toBe(false);
  });

  it('builds deterministic job ids BullMQ accepts (no colon)', () => {
    expect(webinarJobId('webinar.remind', 'reg_1', 60)).toBe('webinar.remind/reg_1/60');
    expect(webinarReminderJobIds('reg_1')).toEqual(REMINDER_OFFSETS_MINUTES.map((o) => `webinar.remind/reg_1/${o}`));
    expect(webinarJobId('webinar.recording.start', 'w1')).not.toContain(':');
  });

  it('schedules each reminder offset still in the future (WBN-05)', () => {
    const inTwoDays = new Date(NOW.getTime() + 2 * 24 * 60 * MINUTE);
    expect(webinarReminderSchedule(inTwoDays, NOW).map((r) => r.offsetMinutes)).toEqual([...REMINDER_OFFSETS_MINUTES]);
    expect(webinarReminderSchedule(new Date(NOW.getTime() + 3 * 60 * MINUTE), NOW)).toEqual([
      { offsetMinutes: 60, delayMs: 2 * 60 * MINUTE },
    ]);
    expect(webinarReminderSchedule(new Date(NOW.getTime() + 30 * MINUTE), NOW)).toEqual([]);
  });
});

describe('webinar job context (T-CW-2.5)', () => {
  it('counts attempts from 1 and keeps the first enqueue time for deadlines', () => {
    expect(webinarJobContext({ attemptsMade: 0, opts: { attempts: 3 }, timestamp: NOW.getTime() })).toEqual({
      attempt: 1,
      maxAttempts: 3,
      enqueuedAt: NOW,
    });
    expect(webinarJobContext({ attemptsMade: 2, opts: {}, timestamp: NOW.getTime() })).toMatchObject({ attempt: 3, maxAttempts: 1 });
  });
});

describe('WebinarJobSchedulerService without Redis', () => {
  it('schedules nothing and does not start', async () => {
    const scheduler = new WebinarJobSchedulerService(config());
    expect(await scheduler.scheduleReminders({ id: 'reg_1', webinarId: 'w1' }, new Date(NOW.getTime() + 2 * 86_400_000), NOW)).toBe(0);
    expect(await scheduler.enqueueRecordingStart('w1', null)).toBe(false);
    await scheduler.cancelReminders('reg_1');
    expect(await scheduler.start({ handle: vi.fn() })).toBe(false);
  });
});

describe('WebinarJobSchedulerService on Redis', async () => {
  const redisUp = await redisAnswers(REDIS_URL);
  const prefix = `nestself-test-cw21-${randomBytes(4).toString('hex')}`;
  const scheduler = new WebinarJobSchedulerService(config(REDIS_URL));
  scheduler.prefix = prefix;

  afterAll(async () => {
    const queue = redisUp ? scheduler.getQueue() : null;
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await scheduler.onModuleDestroy();
  });

  it.skipIf(!redisUp)('adds the reminders by id, idempotently, and removes them by id (CW-R-37a)', async () => {
    const startsAt = new Date(Date.now() + 2 * 24 * 60 * MINUTE);
    expect(await scheduler.scheduleReminders({ id: 'reg_rt', webinarId: 'w_rt' }, startsAt)).toBe(2);
    await scheduler.scheduleReminders({ id: 'reg_rt', webinarId: 'w_rt' }, startsAt);
    const queue = scheduler.getQueue()!;
    const delayed = await queue.getDelayed();
    expect(delayed.map((job) => job.id).sort()).toEqual(webinarReminderJobIds('reg_rt').sort());
    expect(delayed[0]!.data).toMatchObject({ webinarId: 'w_rt', registrationId: 'reg_rt' });

    await scheduler.cancelReminders('reg_rt');
    expect(await queue.getDelayed()).toEqual([]);
  });

  it.skipIf(!redisUp)('runs webinar.recording.start through the worker', async () => {
    const handled: [WebinarJobName, unknown][] = [];
    const done = new Promise<void>((resolve) => {
      void scheduler.start({
        handle: async <N extends WebinarJobName>(name: N, data: WebinarJobData[N]) => {
          handled.push([name, data]);
          resolve();
          return { ok: true };
        },
      });
    });
    expect(await scheduler.enqueueRecordingStart('w_rt', 'session_rt')).toBe(true);
    await done;
    expect(handled).toEqual([['webinar.recording.start', { webinarId: 'w_rt', sessionId: 'session_rt' }]]);
  });

  it.skipIf(!redisUp)('runs a delayed job again without spending an attempt (WebinarJobDelay)', async () => {
    const delayedPrefix = `${prefix}-delay`;
    const delayed = new WebinarJobSchedulerService(config(REDIS_URL));
    delayed.prefix = delayedPrefix;
    const contexts: WebinarJobContext[] = [];
    try {
      const done = new Promise<void>((resolve) => {
        void delayed.start({
          handle: async (_name, _data, context) => {
            contexts.push(context!);
            if (contexts.length === 1) throw new WebinarJobDelay(10);
            resolve();
            return { ok: true };
          },
        });
      });
      expect(await delayed.enqueueRecordingFinalize('w_delay', 'session_delay')).toBe(true);
      await done;
      expect(contexts.map((c) => [c.attempt, c.maxAttempts])).toEqual([
        [1, 3],
        [1, 3],
      ]);
      expect(contexts[1]!.enqueuedAt).toEqual(contexts[0]!.enqueuedAt);
    } finally {
      await delayed.getQueue()?.obliterate({ force: true }).catch(() => undefined);
      await delayed.onModuleDestroy();
    }
  });
});
