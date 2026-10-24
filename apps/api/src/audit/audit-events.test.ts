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
];

describe('calls and webinars audit events', () => {
  it('catalogues all 42 canonical events exactly once', () => {
    expect(CALLS_WEBINARS_AUDIT_CATEGORIES).toHaveLength(42);
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

  it('strips the Chime attendee JoinToken when nested', () => {
    const details = {
      sessionId: 's1',
      attendee: { AttendeeId: 'a1', ExternalUserId: 'p1', JoinToken: 'secret' },
      credentials: [{ joinToken: 'secret' }],
    };
    expect(sanitizeDetails(details)).toEqual({
      sessionId: 's1',
      attendee: { AttendeeId: 'a1', ExternalUserId: 'p1' },
      credentials: [{}],
    });
  });
});
