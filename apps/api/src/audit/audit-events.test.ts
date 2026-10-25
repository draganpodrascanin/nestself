/**
 * Audit catalogue of NS-CALLS-01: every canonical event is catalogued with the
 * category of guidelines section 7.5, and the join token never reaches the
 * audit details.
 *
 * @see docs/tasks/calls-webinars/02-decisions.md section 7 (audit events)
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md 7.5, CW-R-27a, CW-R-33b, CW-R-69
 */
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, categoryFor, type AuditAction, type AuditCategory } from './audit-events.js';
import { sanitizeDetails } from './audit-writer.js';

const CALLS_WEBINARS_AUDIT_CATEGORIES: ReadonlyArray<readonly [AuditAction, AuditCategory]> = [
  ['appointment.created', 'ADMIN'],
  ['appointment.canceled', 'ADMIN'],
  ['appointment.completed', 'FINANCIAL'],
  ['appointment.no_show', 'FINANCIAL'],
  ['appointment.follow_up.proposed', 'ADMIN'],
  ['appointment.confirmed', 'ADMIN'],
  ['appointment.declined', 'ADMIN'],
  ['appointment.times_suggested', 'ADMIN'],
  ['appointment.approval.requested', 'ADMIN'],
  ['appointment.approval.approved', 'ADMIN'],
  ['appointment.approval.rejected', 'ADMIN'],
  ['appointment.approval.expired', 'ADMIN'],
  ['appointment.approval.missing_approver', 'ADMIN'],
  ['org.follow_up_policy.changed', 'ADMIN'],
  ['call.session.created', 'ADMIN'],
  ['call.joined', 'SECURITY'],
  ['call.ended', 'ADMIN'],
  ['call.outcome.recorded', 'FINANCIAL'],
  ['call.feedback.submitted', 'ADMIN'],
  ['call.diagnostics.viewed', 'CONTENT_ACCESS'],
  ['call.ticket.issued', 'SECURITY'],
  // CALL-16: a participant's technical problem report, read by support with the diagnostics.
  ['call.problem.reported', 'CONTENT_ACCESS'],
  ['webinar.created', 'ADMIN'],
  ['webinar.published', 'ADMIN'],
  ['webinar.canceled', 'ADMIN'],
  ['webinar.started', 'ADMIN'],
  ['webinar.ended', 'ADMIN'],
  ['webinar.registered', 'ADMIN'],
  ['webinar.unregistered', 'ADMIN'],
  ['webinar.joined', 'SECURITY'],
  ['webinar.message.submitted', 'CONTENT_ACCESS'],
  ['webinar.message.published', 'CONTENT_ACCESS'],
  ['webinar.message.answered', 'CONTENT_ACCESS'],
  ['webinar.message.dismissed', 'CONTENT_ACCESS'],
  ['webinar.floor.given', 'CONTENT_ACCESS'],
  ['webinar.floor.taken', 'CONTENT_ACCESS'],
  ['webinar.poll.opened', 'ADMIN'],
  ['webinar.poll.closed', 'ADMIN'],
  ['webinar.recording.started', 'CONTENT_ACCESS'],
  ['webinar.recording.stopped', 'CONTENT_ACCESS'],
  ['webinar.recording.ready', 'CONTENT_ACCESS'],
  ['webinar.recording.handed_off', 'CONTENT_ACCESS'],
  ['webinar.certificate.issued', 'ADMIN'],
  // T-CW-2.5 additions: the occurrence form's edit (WBN-30), the attendance report view (WBN-33
  // criterion 5: per-registrant presence is personal data, read like the diagnostics), and a
  // recording that could not start or finish (CW-R-121, the audit note of a failure).
  ['webinar.updated', 'ADMIN'],
  ['webinar.attendance.viewed', 'CONTENT_ACCESS'],
  ['webinar.recording.failed', 'CONTENT_ACCESS'],
];

describe('calls and webinars audit events', () => {
  it('catalogues all 46 canonical events exactly once', () => {
    expect(CALLS_WEBINARS_AUDIT_CATEGORIES).toHaveLength(46);
    for (const [action] of CALLS_WEBINARS_AUDIT_CATEGORIES) {
      expect(AUDIT_ACTIONS.filter((a) => a === action), action).toHaveLength(1);
    }
  });

  it('adds no other appointment, call, webinar or follow-up policy event', () => {
    const canonical = new Set<string>(CALLS_WEBINARS_AUDIT_CATEGORIES.map(([a]) => a));
    const family = AUDIT_ACTIONS.filter(
      (a) =>
        a.startsWith('appointment.') ||
        a.startsWith('call.') ||
        a.startsWith('webinar.') ||
        a === 'org.follow_up_policy.changed',
    );
    expect(family.filter((a) => !canonical.has(a))).toEqual([]);
  });

  it.each(CALLS_WEBINARS_AUDIT_CATEGORIES)('categoryFor(%s) is %s', (action, category) => {
    expect(categoryFor(action)).toBe(category);
  });

  it('join and ticket events prove presence (SECURITY); outcomes and completion feed settlement (FINANCIAL)', () => {
    expect(categoryFor('call.joined')).toBe('SECURITY');
    expect(categoryFor('webinar.joined')).toBe('SECURITY');
    expect(categoryFor('call.ticket.issued')).toBe('SECURITY');
    expect(categoryFor('call.outcome.recorded')).toBe('FINANCIAL');
    expect(categoryFor('appointment.completed')).toBe('FINANCIAL');
  });
});

describe('join token never reaches audit details (CW-R-69)', () => {
  it('sanitizeDetails strips joinToken and JoinToken and keeps meetingId', () => {
    expect(sanitizeDetails({ joinToken: 'x', JoinToken: 'y', meetingId: 'z' })).toEqual({ meetingId: 'z' });
  });

  it('matches forbidden keys regardless of casing and separators', () => {
    expect(
      sanitizeDetails({ jointoken: 'a', JOINTOKEN: 'b', join_token: 'c', 'join-token': 'd', meetingId: 'z' }),
    ).toEqual({ meetingId: 'z' });
    expect(sanitizeDetails({ access_token: 'a', RefreshToken: 'b', Body: 'c', IP: 'd', sessionId: 's1' })).toEqual({
      sessionId: 's1',
    });
  });

  it('strips credentials (CW-R-33a) at any depth', () => {
    expect(sanitizeDetails({ credentials: { meeting: {}, attendee: {} }, participantId: 'p1' })).toEqual({
      participantId: 'p1',
    });
    expect(sanitizeDetails({ nested: { Credentials: 'x', role: 'expert' } })).toEqual({ nested: { role: 'expert' } });
  });

  it('keeps legitimate keys that merely contain a forbidden word', () => {
    const kept = {
      codeVerifierHash: 'h',
      tokenFamily: 'f',
      emailNormalised: 'a@example.test',
      meetingId: 'm1',
      participantId: 'p1',
      recordingNoticeShown: true,
    };
    expect(sanitizeDetails(kept)).toEqual(kept);
  });

  it('strips the Chime attendee JoinToken when nested', () => {
    const details = {
      sessionId: 's1',
      attendee: { AttendeeId: 'a1', ExternalUserId: 'p1', JoinToken: 'secret' },
      attendees: [{ joinToken: 'secret', role: 'employee' }],
    };
    expect(sanitizeDetails(details)).toEqual({
      sessionId: 's1',
      attendee: { AttendeeId: 'a1', ExternalUserId: 'p1' },
      attendees: [{ role: 'employee' }],
    });
  });
});

describe('the CALL-34 location text never reaches audit details (CW-R-80a)', () => {
  it('sanitizeDetails strips locationText in any spelling and at any depth', () => {
    expect(
      sanitizeDetails({ locationText: 'Novi Sad', location_text: 'Subotica', session: { LocationText: 'Sombor', id: 's1' } }),
    ).toEqual({ session: { id: 's1' } });
  });
});
