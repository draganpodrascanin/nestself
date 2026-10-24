/**
 * CallsJobSchedulerService unit tests (T-CW-1.2): job ids, delays and the
 * reminder offsets (CW-R-46), and the no-Redis behaviour. The BullMQ round
 * trip runs against Redis in `test/jobs.e2e.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DbService } from '../db/db.service.js';
import { CALL_ROOM_CLOSE_AFTER_MINUTES, REMINDER_OFFSETS_MINUTES } from '@nestself/contracts';
import {
  CALLS_JOB_NAMES,
  CALLS_QUEUE,
  CallsJobSchedulerService,
  NO_SHOW_FOLLOW_UP_DELAY_MS,
  callsJobId,
  cleanupDelayMs,
  isCallsJobName,
  noShowFollowUpDelayMs,
  reminderSchedule,
  roomClosesAt,
} from './calls-job-scheduler.service.js';

const MINUTE = 60_000;
const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('calls job scheduling rules', () => {
  it('uses the canonical queue and job names (decision record section 7)', () => {
    expect(CALLS_QUEUE).toBe('nestself-calls');
    expect([...CALLS_JOB_NAMES].sort()).toEqual(
      ['appointment.remind', 'calls.cleanup', 'calls.no_show_followup', 'calls.reconcile'].sort(),
    );
    expect(isCallsJobName('calls.cleanup')).toBe(true);
    expect(isCallsJobName('grants.reconcile')).toBe(false);
  });

  it('builds deterministic job ids BullMQ accepts (no colon)', () => {
    expect(callsJobId('appointment.remind', 'appt_1', 1440)).toBe('appointment.remind/appt_1/1440');
    expect(callsJobId('calls.cleanup', 'session_1')).toBe('calls.cleanup/session_1');
    expect(callsJobId('calls.no_show_followup', 'appt_1')).not.toContain(':');
  });

  it('closes the room CALL_ROOM_CLOSE_AFTER_MINUTES after the end (D-CW-09)', () => {
    const endsAt = new Date(NOW.getTime() + 50 * MINUTE);
    expect(roomClosesAt(endsAt)).toEqual(new Date(endsAt.getTime() + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE));
    expect(cleanupDelayMs(endsAt, NOW)).toBe((50 + CALL_ROOM_CLOSE_AFTER_MINUTES) * MINUTE);
    expect(cleanupDelayMs(new Date(NOW.getTime() - 60 * MINUTE), NOW)).toBe(0);
  });

  it('schedules each reminder offset still in the future (CW-R-46)', () => {
    const inTwoDays = new Date(NOW.getTime() + 2 * 24 * 60 * MINUTE);
    expect(reminderSchedule(inTwoDays, NOW)).toEqual(
      REMINDER_OFFSETS_MINUTES.map((offsetMinutes) => ({
        offsetMinutes,
        delayMs: inTwoDays.getTime() - offsetMinutes * MINUTE - NOW.getTime(),
      })),
    );
    // Starts in 3 hours: the 24-hour reminder has passed, the 1-hour one has not.
    const inThreeHours = new Date(NOW.getTime() + 3 * 60 * MINUTE);
    expect(reminderSchedule(inThreeHours, NOW)).toEqual([{ offsetMinutes: 60, delayMs: 2 * 60 * MINUTE }]);
    // Starts in 30 minutes: no reminder left.
    expect(reminderSchedule(new Date(NOW.getTime() + 30 * MINUTE), NOW)).toEqual([]);
  });

  it('follows a no-show up 48 hours after the appointment ends, at once when that has passed', () => {
    expect(NO_SHOW_FOLLOW_UP_DELAY_MS).toBe(48 * 60 * MINUTE);
    const endedAnHourAgo = new Date(NOW.getTime() - 60 * MINUTE);
    expect(noShowFollowUpDelayMs(endedAnHourAgo, NOW)).toBe(47 * 60 * MINUTE);
    expect(noShowFollowUpDelayMs(new Date(NOW.getTime() - 3 * 24 * 60 * MINUTE), NOW)).toBe(0);
  });
});

/** A database stub whose one appointment lookup finds `endsAt`, or nothing (the SQL runs in the e2e suite). */
function dbWith(endsAt: Date | null): DbService {
  const chain = {
    from: () => chain,
    where: async () => (endsAt ? [{ endsAt }] : []),
  };
  return { db: { select: () => chain } } as unknown as DbService;
}

describe('CallsJobSchedulerService.scheduleNoShowFollowUp', () => {
  const config = { get: () => undefined } as unknown as ConfigService;

  function withQueue(scheduler: CallsJobSchedulerService) {
    const add = vi.fn(async () => ({}));
    vi.spyOn(scheduler as unknown as { ensureQueue: () => unknown }, 'ensureQueue').mockReturnValue({ add });
    return add;
  }

  it('reads the appointment end and delays the job until 48 hours after it', async () => {
    const endsAt = new Date(NOW.getTime() - 30 * MINUTE);
    const scheduler = new CallsJobSchedulerService(config, dbWith(endsAt));
    const add = withQueue(scheduler);

    expect(await scheduler.scheduleNoShowFollowUp('appt_1', NOW)).toBe(true);
    expect(add).toHaveBeenCalledWith(
      'calls.no_show_followup',
      { appointmentId: 'appt_1' },
      expect.objectContaining({
        jobId: 'calls.no_show_followup/appt_1',
        delay: endsAt.getTime() + 48 * 60 * MINUTE - NOW.getTime(),
      }),
    );
  });

  it('schedules nothing for an appointment that does not exist', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const scheduler = new CallsJobSchedulerService(config, dbWith(null));
    const add = withQueue(scheduler);
    expect(await scheduler.scheduleNoShowFollowUp('appt_missing', NOW)).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('CallsJobSchedulerService without Redis', () => {
  const config = { get: () => undefined } as unknown as ConfigService;

  it('schedules nothing, removes nothing and does not start', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const scheduler = new CallsJobSchedulerService(config, dbWith(null));
    expect(await scheduler.scheduleCleanup({ id: 's', endsAt: NOW, appointmentId: 'a' }, NOW)).toBe(false);
    expect(await scheduler.scheduleReminders({ id: 'a', startsAt: new Date(NOW.getTime() + 2 * 24 * 60 * MINUTE) }, NOW)).toBe(0);
    expect(await scheduler.scheduleNoShowFollowUp('a')).toBe(false);
    await expect(scheduler.cancelAppointmentJobs('a')).resolves.toBeUndefined();
    expect(await scheduler.start({ handle: async () => undefined })).toBe(false);
    expect(scheduler.getQueue()).toBeNull();
    await scheduler.onModuleDestroy();
  });
});
