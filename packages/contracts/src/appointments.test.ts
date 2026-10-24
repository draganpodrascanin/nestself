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
  AppointmentFollowUpRequestSchema,
  APPOINTMENT_LIST_DEFAULT_LIMIT,
  APPOINTMENT_LIST_MAX_LIMIT,
  AppointmentListQuerySchema,
  AppointmentListResponseSchema,
  AppointmentResponseSchema,
  AppointmentSchema,
  AppointmentStatusSchema,
  AppointmentSuggestTimesRequestSchema,
  AppointmentRemindPayloadSchema,
  FOLLOW_UP_APPROVAL_POLICIES,
  FOLLOW_UP_APPROVAL_POLICY_DEFAULT,
  FOLLOW_UP_DURATION_MAX_MINUTES,
  FOLLOW_UP_DURATION_MIN_MINUTES,
  FOLLOW_UP_MAX_SUGGESTED_WINDOWS,
  FollowUpApprovalPolicySchema,
  FollowUpConfirmRequestSchema,
  FollowUpDeclineRequestSchema,
  FollowUpProposeRequestSchema,
  FollowUpScheduleRequestSchema,
  FollowUpSuggestTimesRequestSchema,
  TimeZoneSchema,
  USER_ROOM_EVENT_NAMES,
  canTransitionAppointment,
  isIanaTimeZone,
  userRoomName,
  type AppointmentStatus,
} from './appointments.ts';
import * as appointmentsModule from './appointments.ts';

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
  it('accepts IANA zone names, including newer names and aliases', () => {
    for (const tz of [
      'Europe/Belgrade',
      'Europe/Budapest',
      'Europe/Kyiv',
      'Asia/Kolkata',
      'Etc/UTC',
      'UTC',
      'Etc/GMT+1',
      'America/New_York',
      'America/Port-au-Prince',
      'America/Argentina/Buenos_Aires',
    ]) {
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

  it('rejects lower-case segments that Intl would otherwise match', () => {
    for (const tz of ['europe/belgrade', 'Europe/belgrade', 'utc', 'america/new_york', 'Europe/kyiv']) {
      expect(isIanaTimeZone(tz), tz).toBe(false);
      expect(TimeZoneSchema.safeParse(tz).success, tz).toBe(false);
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
    const page = { items: [appointment], nextCursor: 'cursor_1' };
    expect(AppointmentListResponseSchema.parse(page)).toEqual(page);
    expect(AppointmentListResponseSchema.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
    expect(AppointmentListResponseSchema.safeParse({}).success).toBe(false);
    expect(issuePaths(AppointmentListResponseSchema.safeParse({ items: [appointment] }))).toEqual(['nextCursor']);
    expect(
      issuePaths(AppointmentListResponseSchema.safeParse({ items: [{ ...appointment, id: '' }], nextCursor: null })),
    ).toEqual(['items.0.id']);
  });
});

describe('AppointmentListQuerySchema (GET /appointments, CALL-18, CALL-28)', () => {
  it('defaults the page size and accepts every filter, coercing the query-string limit', () => {
    expect(AppointmentListQuerySchema.parse({})).toEqual({ limit: APPOINTMENT_LIST_DEFAULT_LIMIT });
    expect(APPOINTMENT_LIST_DEFAULT_LIMIT).toBe(50);
    expect(APPOINTMENT_LIST_MAX_LIMIT).toBe(100);
    const query = {
      cursor: 'cursor_1',
      limit: '20',
      orgId: 'org_1',
      status: 'proposed',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
    };
    expect(AppointmentListQuerySchema.parse(query)).toEqual({ ...query, limit: 20 });
  });

  it('bounds the page size', () => {
    expect(AppointmentListQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    for (const limit of ['0', '101', '2.5', 'ten']) {
      expect(issuePaths(AppointmentListQuerySchema.safeParse({ limit })), limit).toEqual(['limit']);
    }
  });

  it('rejects an unknown status, a non-ISO date, an empty cursor and a range that ends before it starts', () => {
    expect(issuePaths(AppointmentListQuerySchema.safeParse({ status: 'booked' }))).toEqual(['status']);
    expect(issuePaths(AppointmentListQuerySchema.safeParse({ from: '1 Nov 2026' }))).toEqual(['from']);
    expect(issuePaths(AppointmentListQuerySchema.safeParse({ cursor: '' }))).toEqual(['cursor']);
    const reversed = { from: '2026-12-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
    expect(issuePaths(AppointmentListQuerySchema.safeParse(reversed))).toEqual(['to']);
    expect(issuePaths(AppointmentListQuerySchema.safeParse({ ...reversed, to: reversed.from }))).toEqual(['to']);
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

describe('AppointmentFollowUpRequestSchema (CALL-35, guidelines section 6)', () => {
  const valid = { startsAt: '2026-11-10T08:30:00.000Z', durationMinutes: 50, timeZone: 'Europe/Belgrade' };

  it('accepts a valid proposal', () => {
    expect(AppointmentFollowUpRequestSchema.parse(valid)).toEqual(valid);
  });

  it('keeps the T-CW-1.9 name as an alias', () => {
    expect(FollowUpProposeRequestSchema).toBe(AppointmentFollowUpRequestSchema);
  });

  it('rejects each missing required field with its path', () => {
    for (const field of ['startsAt', 'durationMinutes', 'timeZone'] as const) {
      const input: Record<string, unknown> = { ...valid };
      delete input[field];
      expect(issuePaths(AppointmentFollowUpRequestSchema.safeParse(input)), field).toEqual([field]);
    }
  });

  it('rejects a non-ISO start, an invalid time zone and an out-of-range duration', () => {
    expect(issuePaths(AppointmentFollowUpRequestSchema.safeParse({ ...valid, startsAt: '2026-11-10 09:30' }))).toEqual([
      'startsAt',
    ]);
    expect(issuePaths(AppointmentFollowUpRequestSchema.safeParse({ ...valid, timeZone: 'europe/belgrade' }))).toEqual([
      'timeZone',
    ]);
    expect(
      issuePaths(
        AppointmentFollowUpRequestSchema.safeParse({ ...valid, durationMinutes: FOLLOW_UP_DURATION_MIN_MINUTES - 1 }),
      ),
    ).toEqual(['durationMinutes']);
    expect(
      issuePaths(
        AppointmentFollowUpRequestSchema.safeParse({ ...valid, durationMinutes: FOLLOW_UP_DURATION_MAX_MINUTES + 1 }),
      ),
    ).toEqual(['durationMinutes']);
    expect(issuePaths(AppointmentFollowUpRequestSchema.safeParse({ ...valid, durationMinutes: 50.5 }))).toEqual([
      'durationMinutes',
    ]);
  });

  it('carries no free text from expert to employee (D-CW-04, D-22)', () => {
    const parsed = AppointmentFollowUpRequestSchema.parse({ ...valid, note: 'Bring your notes' });
    expect(parsed).not.toHaveProperty('note');
    expect(Object.keys(AppointmentFollowUpRequestSchema.shape).sort()).toEqual(['durationMinutes', 'startsAt', 'timeZone']);
    expect('FOLLOW_UP_NOTE_MAX_LENGTH' in appointmentsModule).toBe(false);
  });

  it('exposes the follow-up limits', () => {
    expect(FOLLOW_UP_DURATION_MIN_MINUTES).toBe(15);
    expect(FOLLOW_UP_DURATION_MAX_MINUTES).toBe(120);
    expect(FOLLOW_UP_MAX_SUGGESTED_WINDOWS).toBe(3);
    expect(APPROVAL_SAFE_REASON_MAX_LENGTH).toBe(300);
  });
});

describe('AppointmentSuggestTimesRequestSchema (CALL-37)', () => {
  const window = (day: number) => ({
    startsAt: `2026-11-${String(day).padStart(2, '0')}T09:00:00.000Z`,
    endsAt: `2026-11-${String(day).padStart(2, '0')}T09:50:00.000Z`,
  });

  it('keeps the T-CW-1.9 name as an alias', () => {
    expect(FollowUpSuggestTimesRequestSchema).toBe(AppointmentSuggestTimesRequestSchema);
  });

  it('accepts one to three windows', () => {
    for (const n of [1, 2, 3]) {
      const windows = Array.from({ length: n }, (_, i) => window(10 + i));
      expect(AppointmentSuggestTimesRequestSchema.parse({ windows })).toEqual({ windows });
    }
  });

  it('rejects zero or more than three windows', () => {
    expect(issuePaths(AppointmentSuggestTimesRequestSchema.safeParse({ windows: [] }))).toEqual(['windows']);
    const four = [window(10), window(11), window(12), window(13)];
    expect(issuePaths(AppointmentSuggestTimesRequestSchema.safeParse({ windows: four }))).toEqual(['windows']);
    expect(issuePaths(AppointmentSuggestTimesRequestSchema.safeParse({}))).toEqual(['windows']);
  });

  it('rejects a window with a missing bound or an end before its start', () => {
    expect(issuePaths(AppointmentSuggestTimesRequestSchema.safeParse({ windows: [{ startsAt: window(10).startsAt }] }))).toEqual([
      'windows.0.endsAt',
    ]);
    const reversed = { startsAt: window(10).endsAt, endsAt: window(10).startsAt };
    expect(issuePaths(AppointmentSuggestTimesRequestSchema.safeParse({ windows: [window(11), reversed] }))).toEqual([
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

describe('AppointmentResponseSchema suggested windows (CALL-37, T-CW-1.9)', () => {
  const windows = [
    { startsAt: '2026-11-20T09:00:00.000Z', endsAt: '2026-11-20T12:00:00.000Z' },
    { startsAt: '2026-11-21T13:00:00.000Z', endsAt: '2026-11-21T15:00:00.000Z' },
  ];

  it('carries the employee’s suggested windows beside the seam, only when there are some', () => {
    const proposed = { ...appointment, status: 'proposed', followUpOf: 'appt_0', suggestedWindows: windows };
    expect(AppointmentResponseSchema.parse(proposed)).toEqual(proposed);
    expect(AppointmentResponseSchema.parse(appointment)).not.toHaveProperty('suggestedWindows');
    // The seam itself stays exact (D-CW-02).
    expect(AppointmentSchema.parse(proposed)).not.toHaveProperty('suggestedWindows');
  });

  it('rejects more than three windows or a reversed window', () => {
    const four = [...windows, ...windows];
    expect(issuePaths(AppointmentResponseSchema.safeParse({ ...appointment, suggestedWindows: four }))).toEqual([
      'suggestedWindows',
    ]);
    const reversed = [{ startsAt: windows[0]!.endsAt, endsAt: windows[0]!.startsAt }];
    expect(issuePaths(AppointmentResponseSchema.safeParse({ ...appointment, suggestedWindows: reversed }))).toEqual([
      'suggestedWindows.0.endsAt',
    ]);
  });
});

describe('Follow-up approval policy default (D-CW-37)', () => {
  it('is automatic', () => {
    expect(FOLLOW_UP_APPROVAL_POLICY_DEFAULT).toBe('automatic');
    expect(FOLLOW_UP_APPROVAL_POLICIES).toContain(FOLLOW_UP_APPROVAL_POLICY_DEFAULT);
  });
});

describe('User room (CALL-42, CALL-01 criterion 5)', () => {
  it('names one room per user', () => {
    expect(userRoomName('user_jovan')).toBe('user:user_jovan');
  });

  it('serves the follow-up proposal and the reminder', () => {
    expect(USER_ROOM_EVENT_NAMES).toEqual(['appointment.follow_up.proposed', 'appointment.remind']);
  });

  it('`appointment.remind` carries ids and times only', () => {
    const payload = { appointmentId: 'appt_1', startsAt: '2026-11-10T09:00:00.000Z', offsetMinutes: 60 };
    expect(AppointmentRemindPayloadSchema.parse(payload)).toEqual(payload);
    expect(AppointmentRemindPayloadSchema.safeParse({ ...payload, serviceCategory: 'psychological' }).success).toBe(false);
    expect(issuePaths(AppointmentRemindPayloadSchema.safeParse({ ...payload, offsetMinutes: 0 }))).toEqual(['offsetMinutes']);
    expect(issuePaths(AppointmentRemindPayloadSchema.safeParse({ ...payload, startsAt: 'tomorrow' }))).toEqual(['startsAt']);
  });
});

describe('AppointmentResponseSchema participants (display only)', () => {
  const people = { expert: { firstName: 'Milica' }, employee: { firstName: 'Jovan' } };

  it('carries each participant’s first name beside the seam, and the expert’s optional photo and credentials', () => {
    const withPeople = { ...appointment, ...people };
    expect(AppointmentResponseSchema.parse(withPeople)).toEqual(withPeople);
    const richer = {
      ...appointment,
      expert: { firstName: 'Milica', photoUrl: 'https://cdn.example/milica.jpg', credentials: 'Licensed psychologist' },
      employee: { firstName: 'Jovan' },
    };
    expect(AppointmentResponseSchema.parse(richer)).toEqual(richer);
    expect(AppointmentSchema.parse(withPeople)).not.toHaveProperty('expert');
  });

  it('never carries a surname or an address', () => {
    expect(
      AppointmentResponseSchema.safeParse({ ...appointment, ...people, employee: { firstName: 'Jovan', lastName: 'Petrović' } })
        .success,
    ).toBe(false);
    expect(
      AppointmentResponseSchema.safeParse({ ...appointment, ...people, expert: { firstName: 'Milica', email: 'm@example.com' } })
        .success,
    ).toBe(false);
    expect(issuePaths(AppointmentResponseSchema.safeParse({ ...appointment, employee: { firstName: '' } }))).toEqual([
      'employee.firstName',
    ]);
  });
});
