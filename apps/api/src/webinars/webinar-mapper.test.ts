/**
 * Webinar mapper and rule tests (T-CW-2.1): enum spellings (CW-R-19a), the
 * join windows (D-CW-17), attendee capabilities (D-CW-35, CW-R-108), the
 * audience rule (D-CW-17, CW-R-32), cursors and the attendance arithmetic
 * (WBN-33).
 */
import { describe, expect, it } from 'vitest';
import {
  CALL_JOIN_WINDOW_BEFORE_MINUTES,
  CALL_ROOM_CLOSE_AFTER_MINUTES,
  WEBINAR_HOST_JOIN_BEFORE_MINUTES,
  WEBINAR_STATUSES,
  WebinarAttendeeCapabilitiesSchema,
} from '@nestself/contracts';
import { capabilitiesForRole } from '../video/video-provider.js';
import {
  attendedMinutes,
  attendeeCapabilities,
  completionPercent,
  decodePageCursor,
  eligibleOrgId,
  encodePageCursor,
  fromDbWebinarStatus,
  isWithinWebinarWindow,
  occurrenceOrgId,
  paginate,
  peakConcurrent,
  toContractCapabilities,
  toDbWebinarStatus,
  type MembershipFact,
} from './webinar-mapper.js';

const MINUTE = 60_000;
const START = new Date('2026-11-25T16:00:00.000Z');
const END = new Date('2026-11-25T17:00:00.000Z');
const at = (minutesFromStart: number) => new Date(START.getTime() + minutesFromStart * MINUTE);

describe('enum spellings (CW-R-19a)', () => {
  it('maps every webinar status both ways', () => {
    for (const status of WEBINAR_STATUSES) {
      expect(fromDbWebinarStatus(toDbWebinarStatus(status))).toBe(status);
    }
    expect(toDbWebinarStatus('published')).toBe('PUBLISHED');
  });
});

describe('join windows (D-CW-17, WBN-06, WBN-16)', () => {
  const window = { startsAt: START, endsAt: END };

  it('opens 30 minutes before the start for hosts and 15 minutes before for attendees', () => {
    expect(isWithinWebinarWindow(window, at(-WEBINAR_HOST_JOIN_BEFORE_MINUTES), 'host')).toBe(true);
    expect(isWithinWebinarWindow(window, at(-WEBINAR_HOST_JOIN_BEFORE_MINUTES - 1), 'host')).toBe(false);
    expect(isWithinWebinarWindow(window, at(-CALL_JOIN_WINDOW_BEFORE_MINUTES), 'attendee')).toBe(true);
    expect(isWithinWebinarWindow(window, at(-CALL_JOIN_WINDOW_BEFORE_MINUTES - 1), 'attendee')).toBe(false);
  });

  it('closes 15 minutes after the scheduled end for everyone', () => {
    const closes = new Date(END.getTime() + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE);
    for (const kind of ['host', 'attendee'] as const) {
      expect(isWithinWebinarWindow(window, closes, kind)).toBe(true);
      expect(isWithinWebinarWindow(window, new Date(closes.getTime() + 1), kind)).toBe(false);
    }
  });
});

describe('attendee capabilities (D-CW-35, CW-R-108, WBN-07, WBN-08)', () => {
  it('never sends video or content, with or without the floor', () => {
    for (const floor of [false, true]) {
      const capabilities = attendeeCapabilities(floor);
      expect(capabilities.Video).toBe('Receive');
      expect(capabilities.Content).toBe('Receive');
      expect(WebinarAttendeeCapabilitiesSchema.safeParse(toContractCapabilities(capabilities)).success).toBe(true);
    }
  });

  it('sends audio only while the attendee has the floor', () => {
    expect(attendeeCapabilities(false)).toEqual({ Audio: 'Receive', Video: 'Receive', Content: 'Receive' });
    expect(attendeeCapabilities(true)).toEqual({ Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' });
  });

  it('reports host capabilities in contract spelling', () => {
    expect(toContractCapabilities(capabilitiesForRole('presenter'))).toEqual({
      audio: 'send_receive',
      video: 'send_receive',
      content: 'send_receive',
    });
  });
});

describe('audience (D-CW-17, CW-R-32)', () => {
  const memberOfA: MembershipFact = { orgId: 'org_a', orgUnitAncestorIds: ['unit_team', 'unit_dept', 'unit_company'] };
  const memberOfB: MembershipFact = { orgId: 'org_b', orgUnitAncestorIds: [] };

  it('takes every member of an active client organisation for all_eligible', () => {
    expect(eligibleOrgId({ type: 'all_eligible' }, [memberOfA])).toBe('org_a');
    expect(eligibleOrgId({ type: 'all_eligible' }, [])).toBeNull();
  });

  it('takes the members of a listed organisation, preferring the active one', () => {
    const policy = { type: 'organization', orgIds: ['org_a', 'org_b'] } as const;
    expect(eligibleOrgId(policy, [memberOfA, memberOfB], 'org_b')).toBe('org_b');
    expect(eligibleOrgId({ type: 'organization', orgIds: ['org_c'] }, [memberOfA, memberOfB])).toBeNull();
  });

  it('takes the members of a listed unit or a unit below it, in that organisation only', () => {
    expect(eligibleOrgId({ type: 'org_unit', orgId: 'org_a', orgUnitIds: ['unit_dept'] }, [memberOfA])).toBe('org_a');
    expect(eligibleOrgId({ type: 'org_unit', orgId: 'org_a', orgUnitIds: ['unit_other'] }, [memberOfA])).toBeNull();
    expect(
      eligibleOrgId({ type: 'org_unit', orgId: 'org_b', orgUnitIds: ['unit_dept'] }, [{ ...memberOfA, orgId: 'org_b_x' }]),
    ).toBeNull();
  });

  it('gives an occurrence the one organisation its audience names (CW-R-23)', () => {
    expect(occurrenceOrgId({ type: 'all_eligible' })).toBeNull();
    expect(occurrenceOrgId({ type: 'organization', orgIds: ['org_a'] })).toBe('org_a');
    expect(occurrenceOrgId({ type: 'organization', orgIds: ['org_a', 'org_b'] })).toBeNull();
    expect(occurrenceOrgId({ type: 'org_unit', orgId: 'org_a', orgUnitIds: ['unit_team'] })).toBe('org_a');
  });
});

describe('cursors', () => {
  it('round-trips a page key and refuses anything else', () => {
    const key = { at: START, id: 'webinar_1' };
    expect(decodePageCursor(encodePageCursor(key))).toEqual(key);
    expect(decodePageCursor('not-a-cursor')).toBeNull();
    expect(decodePageCursor(Buffer.from(JSON.stringify(['x', 'y'])).toString('base64url'))).toBeNull();
  });

  it('pages limit + 1 rows into a page and the next cursor', () => {
    const rows = [1, 2, 3].map((n) => ({ at: at(n), id: `w${n}` }));
    const page = paginate(rows, 2, (row) => row);
    expect(page.items.map((row) => row.id)).toEqual(['w1', 'w2']);
    expect(decodePageCursor(page.nextCursor!)).toEqual(rows[1]);
    expect(paginate(rows, 3, (row) => row).nextCursor).toBeNull();
  });
});

describe('attendance (WBN-33)', () => {
  it('counts attended minutes from the first join to the last leave, or until now while present', () => {
    expect(attendedMinutes({ joinedAt: at(0), leftAt: at(45) }, at(60))).toBe(45);
    expect(attendedMinutes({ joinedAt: at(10), leftAt: null }, at(40))).toBe(30);
    expect(attendedMinutes({ joinedAt: null, leftAt: null }, at(60))).toBeNull();
  });

  it('caps completion at 100 percent', () => {
    expect(completionPercent(45, 60)).toBe(75);
    expect(completionPercent(70, 60)).toBe(100);
    expect(completionPercent(null, 60)).toBeNull();
  });

  it('finds the most people present at the same time', () => {
    const intervals = [
      { joinedAt: at(0), leftAt: at(30) },
      { joinedAt: at(10), leftAt: at(20) },
      { joinedAt: at(30), leftAt: at(50) },
      { joinedAt: at(15), leftAt: null },
      { joinedAt: null, leftAt: null },
    ];
    expect(peakConcurrent(intervals, at(60))).toBe(3);
    expect(peakConcurrent([], at(60))).toBe(0);
  });
});
