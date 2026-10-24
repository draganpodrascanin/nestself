import { describe, expect, it } from 'vitest';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { SAMPLE_APPOINTMENTS, SAMPLE_CALL_SESSIONS, SAMPLE_GRANTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import {
  EXTRA_SAMPLE_TEMPLATES,
  extraSampleGrantIds,
  sampleAppointmentRow,
  sampleCallSessionRows,
  seededSampleCallSessions,
  templatesForLegacyRoles,
} from './seed-lib.js';

const keys = (orgRole: string | null, platformRole: string | null) =>
  templatesForLegacyRoles(orgRole, platformRole)
    .map((tmpl) => tmpl.key)
    .sort();

describe('templatesForLegacyRoles', () => {
  it('maps a plain employee to the employee template only', () => {
    expect(keys('EMPLOYEE', null)).toEqual(['employee']);
  });

  it('adds the employee template to every org role', () => {
    expect(keys('MANAGER', null)).toEqual(['employee', 'team_manager']);
    expect(keys('HR_ADMIN', null)).toEqual(['employee', 'hr_admin']);
  });

  it('maps platform roles without the employee template', () => {
    expect(keys(null, 'EXPERT')).toEqual(['expert', 'expert_lead']);
    expect(keys(null, 'ADMIN')).toEqual(['platform_owner']);
    expect(keys(null, 'OPERATIONS')).toEqual(
      [
        'client_operations',
        'content_author',
        'content_publisher',
        'nestself_finance',
        'service_coordinator',
        'support_operator',
      ].sort(),
    );
  });

  it('accepts lower-case fixture roles', () => {
    expect(keys('hr_admin', null)).toEqual(['employee', 'hr_admin']);
  });

  it('never derives a template that has no legacy role', () => {
    for (const [org, platform] of [
      [null, null],
      ['EMPLOYEE', null],
      [null, 'EXPERT'],
    ] as const) {
      expect(templatesForLegacyRoles(org, platform).every((tmpl) => tmpl.legacyRole != null)).toBe(true);
    }
    expect(keys(null, null)).toEqual([]);
  });
});

describe('EXTRA_SAMPLE_TEMPLATES', () => {
  it('makes the sample HR admin the employer owner as well', () => {
    expect(EXTRA_SAMPLE_TEMPLATES).toEqual({ user_ivana: ['employer_owner'] });
    expect(extraSampleGrantIds()).toEqual(['grant_user_ivana_employer_owner']);
  });

  it('names only known templates', () => {
    const known = new Set<string>(PERMISSION_TEMPLATES.map((tmpl) => tmpl.key));
    expect(Object.values(EXTRA_SAMPLE_TEMPLATES).flat().every((key) => known.has(key))).toBe(true);
  });

  it('seeds the same 17 grant ids as SAMPLE_GRANTS', () => {
    const derived = SAMPLE_PEOPLE.filter((p) => p.orgId || p.platformRole).flatMap((p) =>
      templatesForLegacyRoles(p.orgRole ?? null, p.platformRole ?? null).map((tmpl) => `grant_${p.id}_${tmpl.key}`),
    );
    const seeded = [...derived, ...extraSampleGrantIds()].sort();
    expect(seeded).toHaveLength(17);
    expect(seeded).toEqual(SAMPLE_GRANTS.map((g) => g.id).sort());
  });
});

describe('sample appointments and call sessions (T-CW-1.1)', () => {
  it('maps every sample appointment to its UPPER_CASE status', () => {
    const rows = SAMPLE_APPOINTMENTS.map(sampleAppointmentRow);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['appt_sample_completed', 'COMPLETED'],
      ['appt_sample_canceled', 'CANCELED'],
      ['appt_sample_follow_up_proposed', 'PROPOSED'],
      ['appt_sample_follow_up_awaiting', 'AWAITING_APPROVAL'],
      ['appt_sample_upcoming', 'CONFIRMED'],
    ]);
    expect(rows[2]).toMatchObject({ followUpOf: 'appt_sample_completed', startsAt: new Date('2026-11-04T15:00:00.000Z') });
    // The fixture marker is not a column.
    expect(rows.every((r) => !('sample' in r))).toBe(true);
  });

  it('seeds the consultation session only; the webinar session waits for the webinars table (T-CW-2.1)', () => {
    expect(SAMPLE_CALL_SESSIONS.map((s) => s.format)).toEqual(['consultation', 'webinar']);
    expect(seededSampleCallSessions().map((s) => s.id)).toEqual(['call_session_sample_consultation']);
  });

  it('maps the consultation session, participants, outcome and feedback to the UPPER_CASE enums', () => {
    const [session] = seededSampleCallSessions();
    const rows = sampleCallSessionRows(session!);
    expect(rows.session).toMatchObject({
      id: 'call_session_sample_consultation',
      appointmentId: 'appt_sample_completed',
      orgId: 'org_sample',
      format: 'CONSULTATION',
      status: 'ENDED',
      providerMeetingId: 'sample_meeting_consultation',
      startedAt: new Date('2026-10-14T13:56:00.000Z'),
    });
    expect(rows.participants.map((p) => [p.id, p.role, p.orgId])).toEqual([
      ['call_participant_sample_expert', 'EXPERT', 'org_sample'],
      ['call_participant_sample_employee', 'EMPLOYEE', 'org_sample'],
    ]);
    expect(rows.outcome).toMatchObject({ status: 'COMPLETED', sessionId: session!.id, recordedByUserId: 'user_milica' });
    expect(rows.feedback).toEqual([
      {
        id: 'call_feedback_sample_consultation',
        sessionId: session!.id,
        orgId: 'org_sample',
        userId: 'user_jovan',
        score: 4,
        comment: 'Sample feedback comment (fixture)',
      },
    ]);
  });
});
