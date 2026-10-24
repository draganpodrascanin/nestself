import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_APPROVAL_STATUSES,
  APPOINTMENT_SEAM_FIELDS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_TRANSITIONS,
  APPROVAL_SAFE_REASON_MAX_LENGTH,
  AppointmentApprovalDecisionRequestSchema,
  AppointmentApprovalStatusSchema,
  AppointmentCreateRequestSchema,
  AppointmentListResponseSchema,
  AppointmentResponseSchema,
  AppointmentSchema,
  AppointmentStatusSchema,
  FOLLOW_UP_APPROVAL_POLICIES,
  FOLLOW_UP_DURATION_MAX_MINUTES,
  FOLLOW_UP_DURATION_MIN_MINUTES,
  FOLLOW_UP_MAX_SUGGESTED_WINDOWS,
  FOLLOW_UP_NOTE_MAX_LENGTH,
  FollowUpApprovalPolicySchema,
  FollowUpConfirmRequestSchema,
  FollowUpDeclineRequestSchema,
  FollowUpProposeRequestSchema,
  FollowUpScheduleRequestSchema,
  FollowUpSuggestTimesRequestSchema,
  TimeZoneSchema,
  canTransitionAppointment,
  isIanaTimeZone,
  type AppointmentStatus,
} from './appointments.ts';

const appointment = {
  id: 'appt_1',
  orgId: 'org_1',
  expertUserId: 'user_expert',
  employeeUserId: 'user_employee',
  startsAt: '2026-11-03T09:00:00.000Z',
  endsAt: '2026-11-03T09:50:00.000Z',
  status: 'confirmed',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: null,
} as const;

const createRequest = {
  orgId: 'org_1',
  expertUserId: 'user_expert',
  employeeUserId: 'user_employee',
  startsAt: '2026-11-03T09:00:00.000Z',
  endsAt: '2026-11-03T09:50:00.000Z',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
};

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('appointment statuses', () => {
  it('lists the full lifecycle in the canonical order', () => {
    expect(APPOINTMENT_STATUSES).toEqual([
      'proposed',
      'awaiting_approval',
      'confirmed',
      'completed',
      'canceled',
      'declined',
      'no_show',
    ]);
  });

  it('AppointmentStatusSchema accepts every status and rejects others', () => {
    for (const s of APPOINTMENT_STATUSES) {
      expect(AppointmentStatusSchema.parse(s)).toBe(s);
    }
    expect(AppointmentStatusSchema.safeParse('CONFIRMED').success).toBe(false);
    expect(AppointmentStatusSchema.safeParse('scheduled').success).toBe(false);
  });

  it('approval statuses and follow-up policies use the canonical spellings', () => {
    expect(APPOINTMENT_APPROVAL_STATUSES).toEqual(['pending', 'approved', 'rejected', 'expired']);
    expect(AppointmentApprovalStatusSchema.safeParse('pending').success).toBe(true);
    expect(AppointmentApprovalStatusSchema.safeParse('PENDING').success).toBe(false);
    expect(FOLLOW_UP_APPROVAL_POLICIES).toEqual(['automatic', 'manager_approval']);
    expect(FollowUpApprovalPolicySchema.safeParse('manager_approval').success).toBe(true);
    expect(FollowUpApprovalPolicySchema.safeParse('MANAGER_APPROVAL').success).toBe(false);
  });
});

describe('appointment status transitions (CALL-30)', () => {
  const allowed: [AppointmentStatus, AppointmentStatus][] = [
    ['proposed', 'confirmed'],
    ['proposed', 'awaiting_approval'],
    ['proposed', 'declined'],
    ['awaiting_approval', 'confirmed'],
    ['awaiting_approval', 'declined'],
    ['confirmed', 'completed'],
    ['confirmed', 'canceled'],
    ['confirmed', 'no_show'],
  ];

  it('allows exactly the transitions listed in CALL-30', () => {
    const actual: [AppointmentStatus, AppointmentStatus][] = [];
    for (const from of APPOINTMENT_STATUSES) {
      for (const to of APPOINTMENT_STATUS_TRANSITIONS[from]) actual.push([from, to]);
    }
    expect(actual).toEqual(allowed);
  });

  it('canTransitionAppointment agrees with the table for every pair', () => {
    for (const from of APPOINTMENT_STATUSES) {
      for (const to of APPOINTMENT_STATUSES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransitionAppointment(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('terminal statuses have no outgoing transition', () => {
    for (const s of ['completed', 'canceled', 'declined', 'no_show'] as const) {
      expect(APPOINTMENT_STATUS_TRANSITIONS[s]).toEqual([]);
    }
  });
});

describe('time zone validation (CALL-29)', () => {
  it('accepts IANA zone names', () => {
    for (const tz of ['Europe/Belgrade', 'Europe/Budapest', 'UTC', 'America/New_York', 'Etc/GMT+1']) {
      expect(isIanaTimeZone(tz), tz).toBe(true);
      expect(TimeZoneSchema.safeParse(tz).success, tz).toBe(true);
    }
  });

  it('rejects unknown zones, offsets and empty strings', () => {
    for (const tz of ['Mars/Olympus_Mons', '+01:00', '-05:00', '', ' Europe/Belgrade', 'Europe/Belgrade ']) {
      expect(isIanaTimeZone(tz), JSON.stringify(tz)).toBe(false);
      expect(TimeZoneSchema.safeParse(tz).success, JSON.stringify(tz)).toBe(false);
    }
  });
});

describe('AppointmentSchema (seam, CALL-31)', () => {
  it('has exactly the seam fields', () => {
    expect(APPOINTMENT_SEAM_FIELDS).toEqual([
      'id',
      'orgId',
      'expertUserId',
      'employeeUserId',
      'startsAt',
      'endsAt',
      'status',
      'serviceCategory',
      'timeZone',
      'fundingRef',
      'followUpOf',
    ]);
    expect(Object.keys(AppointmentSchema.shape).sort()).toEqual([...APPOINTMENT_SEAM_FIELDS].sort());
  });

  it('accepts a valid appointment, including a follow-up', () => {
    expect(AppointmentSchema.parse(appointment)).toEqual(appointment);
    const followUp = { ...appointment, id: 'appt_2', status: 'proposed', followUpOf: 'appt_1' };
    expect(AppointmentSchema.parse(followUp).followUpOf).toBe('appt_1');
  });

  it('rejects a missing required field with the field path', () => {
    for (const field of APPOINTMENT_SEAM_FIELDS) {
      const input: Record<string, unknown> = { ...appointment };
      delete input[field];
      const result = AppointmentSchema.safeParse(input);
      expect(result.success, field).toBe(false);
      expect(issuePaths(result), field).toContain(field);
    }
  });

  it('rejects an unknown status and a non-ISO start', () => {
    expect(issuePaths(AppointmentSchema.safeParse({ ...appointment, status: 'booked' }))).toEqual(['status']);
    expect(issuePaths(AppointmentSchema.safeParse({ ...appointment, startsAt: '3 Nov 2026' }))).toEqual(['startsAt']);
  });

  it('AppointmentResponseSchema and AppointmentListResponseSchema carry the seam', () => {
    expect(AppointmentResponseSchema.parse(appointment)).toEqual(appointment);
    expect(AppointmentListResponseSchema.parse({ items: [appointment] })).toEqual({ items: [appointment] });
    expect(AppointmentListResponseSchema.safeParse({}).success).toBe(false);
    expect(issuePaths(AppointmentListResponseSchema.safeParse({ items: [{ ...appointment, id: '' }] }))).toEqual([
      'items.0.id',
    ]);
  });
});

describe('AppointmentCreateRequestSchema', () => {
  it('accepts a valid request with and without fundingRef', () => {
    expect(AppointmentCreateRequestSchema.parse(createRequest)).toEqual(createRequest);
    expect(AppointmentCreateRequestSchema.parse({ ...createRequest, fundingRef: 'fund_1' }).fundingRef).toBe('fund_1');
  });

  it('rejects each missing required field with its path', () => {
    for (const field of Object.keys(createRequest)) {
      const input: Record<string, unknown> = { ...createRequest };
      delete input[field];
      const result = AppointmentCreateRequestSchema.safeParse(input);
      expect(result.success, field).toBe(false);
      expect(issuePaths(result), field).toContain(field);
    }
  });

  it('rejects an invalid time zone', () => {
    const result = AppointmentCreateRequestSchema.safeParse({ ...createRequest, timeZone: 'Europe/Atlantis' });
    expect(issuePaths(result)).toEqual(['timeZone']);
  });

  it('rejects an end that is not after the start', () => {
    const same = AppointmentCreateRequestSchema.safeParse({ ...createRequest, endsAt: createRequest.startsAt });
    expect(issuePaths(same)).toEqual(['endsAt']);
    const before = AppointmentCreateRequestSchema.safeParse({ ...createRequest, endsAt: '2026-11-03T08:00:00.000Z' });
    expect(issuePaths(before)).toEqual(['endsAt']);
  });
});

describe('FollowUpProposeRequestSchema (CALL-35)', () => {
  const valid = { date: '2026-11-10', time: '09:30', durationMinutes: 50 };

  it('accepts a valid proposal with and without a note', () => {
    expect(FollowUpProposeRequestSchema.parse(valid)).toEqual(valid);
    expect(FollowUpProposeRequestSchema.parse({ ...valid, note: '  Same time works.  ' }).note).toBe('Same time works.');
  });

  it('rejects each missing required field with its path', () => {
    for (const field of ['date', 'time', 'durationMinutes'] as const) {
      const input: Record<string, unknown> = { ...valid };
      delete input[field];
      expect(issuePaths(FollowUpProposeRequestSchema.safeParse(input)), field).toEqual([field]);
    }
  });

  it('rejects an impossible date, a malformed time and an out-of-range duration', () => {
    expect(issuePaths(FollowUpProposeRequestSchema.safeParse({ ...valid, date: '2026-02-30' }))).toEqual(['date']);
    expect(issuePaths(FollowUpProposeRequestSchema.safeParse({ ...valid, time: '24:00' }))).toEqual(['time']);
    expect(issuePaths(FollowUpProposeRequestSchema.safeParse({ ...valid, time: '9:30' }))).toEqual(['time']);
    expect(
      issuePaths(FollowUpProposeRequestSchema.safeParse({ ...valid, durationMinutes: FOLLOW_UP_DURATION_MIN_MINUTES - 1 })),
    ).toEqual(['durationMinutes']);
    expect(
      issuePaths(FollowUpProposeRequestSchema.safeParse({ ...valid, durationMinutes: FOLLOW_UP_DURATION_MAX_MINUTES + 1 })),
    ).toEqual(['durationMinutes']);
    expect(issuePaths(FollowUpProposeRequestSchema.safeParse({ ...valid, durationMinutes: 50.5 }))).toEqual([
      'durationMinutes',
    ]);
  });

  it('caps the note length', () => {
    const long = 'a'.repeat(FOLLOW_UP_NOTE_MAX_LENGTH + 1);
    expect(issuePaths(FollowUpProposeRequestSchema.safeParse({ ...valid, note: long }))).toEqual(['note']);
  });

  it('exposes the follow-up limits', () => {
    expect(FOLLOW_UP_DURATION_MIN_MINUTES).toBe(15);
    expect(FOLLOW_UP_DURATION_MAX_MINUTES).toBe(120);
    expect(FOLLOW_UP_MAX_SUGGESTED_WINDOWS).toBe(3);
    expect(FOLLOW_UP_NOTE_MAX_LENGTH).toBe(500);
    expect(APPROVAL_SAFE_REASON_MAX_LENGTH).toBe(300);
  });
});

describe('FollowUpSuggestTimesRequestSchema (CALL-37)', () => {
  const window = (day: number) => ({
    startsAt: `2026-11-${String(day).padStart(2, '0')}T09:00:00.000Z`,
    endsAt: `2026-11-${String(day).padStart(2, '0')}T09:50:00.000Z`,
  });

  it('accepts one to three windows', () => {
    for (const n of [1, 2, 3]) {
      const windows = Array.from({ length: n }, (_, i) => window(10 + i));
      expect(FollowUpSuggestTimesRequestSchema.parse({ windows })).toEqual({ windows });
    }
  });

  it('rejects zero or more than three windows', () => {
    expect(issuePaths(FollowUpSuggestTimesRequestSchema.safeParse({ windows: [] }))).toEqual(['windows']);
    const four = [window(10), window(11), window(12), window(13)];
    expect(issuePaths(FollowUpSuggestTimesRequestSchema.safeParse({ windows: four }))).toEqual(['windows']);
    expect(issuePaths(FollowUpSuggestTimesRequestSchema.safeParse({}))).toEqual(['windows']);
  });

  it('rejects a window with a missing bound or an end before its start', () => {
    expect(issuePaths(FollowUpSuggestTimesRequestSchema.safeParse({ windows: [{ startsAt: window(10).startsAt }] }))).toEqual([
      'windows.0.endsAt',
    ]);
    const reversed = { startsAt: window(10).endsAt, endsAt: window(10).startsAt };
    expect(issuePaths(FollowUpSuggestTimesRequestSchema.safeParse({ windows: [window(11), reversed] }))).toEqual([
      'windows.1.endsAt',
    ]);
  });
});

describe('FollowUpScheduleRequestSchema', () => {
  it('accepts an index of one of the three windows', () => {
    for (const i of [0, 1, 2]) {
      expect(FollowUpScheduleRequestSchema.parse({ selectedWindowIndex: i })).toEqual({ selectedWindowIndex: i });
    }
  });

  it('rejects a missing, negative, fractional or out-of-range index', () => {
    for (const value of [undefined, -1, 0.5, FOLLOW_UP_MAX_SUGGESTED_WINDOWS]) {
      expect(
        issuePaths(FollowUpScheduleRequestSchema.safeParse({ selectedWindowIndex: value })),
        String(value),
      ).toEqual(['selectedWindowIndex']);
    }
  });
});

describe('FollowUpConfirmRequestSchema and FollowUpDeclineRequestSchema', () => {
  it('accept an empty body', () => {
    expect(FollowUpConfirmRequestSchema.parse({})).toEqual({});
    expect(FollowUpDeclineRequestSchema.parse({})).toEqual({});
  });

  it('reject unexpected fields', () => {
    expect(FollowUpConfirmRequestSchema.safeParse({ status: 'confirmed' }).success).toBe(false);
    expect(FollowUpDeclineRequestSchema.safeParse({ reason: 'no' }).success).toBe(false);
  });
});

describe('AppointmentApprovalDecisionRequestSchema (CW-R-109)', () => {
  it('accepts a safe reason up to 300 characters', () => {
    expect(AppointmentApprovalDecisionRequestSchema.parse({ safeReason: 'Budget closed this month.' })).toEqual({
      safeReason: 'Budget closed this month.',
    });
    const max = 'a'.repeat(APPROVAL_SAFE_REASON_MAX_LENGTH);
    expect(AppointmentApprovalDecisionRequestSchema.safeParse({ safeReason: max }).success).toBe(true);
  });

  it('rejects a missing, blank or too long reason', () => {
    expect(issuePaths(AppointmentApprovalDecisionRequestSchema.safeParse({}))).toEqual(['safeReason']);
    expect(issuePaths(AppointmentApprovalDecisionRequestSchema.safeParse({ safeReason: '   ' }))).toEqual(['safeReason']);
    const long = 'a'.repeat(APPROVAL_SAFE_REASON_MAX_LENGTH + 1);
    expect(issuePaths(AppointmentApprovalDecisionRequestSchema.safeParse({ safeReason: long }))).toEqual(['safeReason']);
  });
});
