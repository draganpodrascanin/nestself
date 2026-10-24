/**
 * Working days of the approval reminder and expiry (T-CW-1.10, CALL-40):
 * Monday to Friday in Europe/Belgrade, no holiday table, the same wall-clock
 * time on the target day, daylight saving time respected.
 */
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_EXPIRE_AFTER_WORKING_DAYS,
  APPROVAL_REMIND_AFTER_WORKING_DAYS,
  addWorkingDays,
  approvalDeadlines,
} from './approval-schedule.js';

const TZ = 'Europe/Belgrade';

describe('addWorkingDays', () => {
  it('a Monday plus five working days is the next Monday at the same local time', () => {
    // Monday 2026-11-02 10:00 in Belgrade (CET, UTC+1).
    expect(addWorkingDays(new Date('2026-11-02T09:00:00.000Z'), 5, TZ).toISOString()).toBe('2026-11-09T09:00:00.000Z');
  });

  it('skips the weekend from a Thursday', () => {
    // Thursday 2026-11-05 14:30 local + 2 working days = Monday 2026-11-09 14:30 local.
    expect(addWorkingDays(new Date('2026-11-05T13:30:00.000Z'), 2, TZ).toISOString()).toBe('2026-11-09T13:30:00.000Z');
  });

  it('a request on Saturday counts from Monday', () => {
    // Saturday 2026-11-07 11:00 local + 1 working day = Monday 2026-11-09 11:00 local.
    expect(addWorkingDays(new Date('2026-11-07T10:00:00.000Z'), 1, TZ).toISOString()).toBe('2026-11-09T10:00:00.000Z');
  });

  it('uses the Belgrade calendar day, not the UTC one', () => {
    // Friday 2026-11-06 23:30 UTC is already Saturday 00:30 in Belgrade: + 1 working day = Monday 00:30 local.
    expect(addWorkingDays(new Date('2026-11-06T23:30:00.000Z'), 1, TZ).toISOString()).toBe('2026-11-08T23:30:00.000Z');
  });

  it('keeps the local time across the end of daylight saving time', () => {
    // Monday 2026-10-19 10:00 CEST (UTC+2) + 10 working days = Monday 2026-11-02 10:00 CET (UTC+1).
    expect(addWorkingDays(new Date('2026-10-19T08:00:00.000Z'), 10, TZ).toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });

  it('zero days is the same instant', () => {
    const from = new Date('2026-11-04T08:15:00.000Z');
    expect(addWorkingDays(from, 0, TZ).getTime()).toBe(from.getTime());
  });
});

describe('approvalDeadlines', () => {
  it('reminds after five working days and expires after ten', () => {
    expect(APPROVAL_REMIND_AFTER_WORKING_DAYS).toBe(5);
    expect(APPROVAL_EXPIRE_AFTER_WORKING_DAYS).toBe(10);
    const requestedAt = new Date('2026-11-04T12:00:00.000Z'); // Wednesday
    expect(approvalDeadlines(requestedAt)).toEqual({
      remindAt: new Date('2026-11-11T12:00:00.000Z'),
      expireAt: new Date('2026-11-18T12:00:00.000Z'),
    });
  });
});
