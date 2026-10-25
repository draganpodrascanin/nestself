import { describe, expect, it } from 'vitest';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import {
  SAMPLE_APPOINTMENTS,
  SAMPLE_CALL_SESSIONS,
  SAMPLE_GRANTS,
  SAMPLE_PEOPLE,
  SAMPLE_WEBINARS,
  SAMPLE_WEBINAR_MESSAGES,
  SAMPLE_WEBINAR_POLLS,
} from '@nestself/sample-data';
import { WebinarAudiencePolicySchema, WebinarLocalizedTextSchema } from '@nestself/contracts';
import {
  EXTRA_SAMPLE_TEMPLATES,
  extraSampleGrantIds,
  sampleApprovalRows,
  sampleAppointmentRow,
  sampleCallSessionRows,
  sampleWebinarMessageRow,
  sampleWebinarPollRows,
  sampleWebinarRows,
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
    expect(EXTRA_SAMPLE_TEMPLATES).toEqual({ user_ivana: ['employer_owner', 'approver'] });
    expect(extraSampleGrantIds()).toEqual(['grant_user_ivana_employer_owner', 'grant_user_ivana_approver']);
  });

  it('names only known templates', () => {
    const known = new Set<string>(PERMISSION_TEMPLATES.map((tmpl) => tmpl.key));
    expect(Object.values(EXTRA_SAMPLE_TEMPLATES).flat().every((key) => known.has(key))).toBe(true);
  });

  it('seeds the same 19 grant ids as SAMPLE_GRANTS', () => {
    const derived = SAMPLE_PEOPLE.filter((p) => p.orgId || p.platformRole).flatMap((p) =>
      templatesForLegacyRoles(p.orgRole ?? null, p.platformRole ?? null).map((tmpl) => `grant_${p.id}_${tmpl.key}`),
    );
    const seeded = [...derived, ...extraSampleGrantIds()].sort();
    // 19 since the platform administrator joined SAMPLE_PEOPLE (platform_owner, T-CW-2.1).
    expect(seeded).toHaveLength(19);
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

  it('seeds the consultation session and, since the webinars tables (T-CW-2.1), the webinar session', () => {
    expect(SAMPLE_CALL_SESSIONS.map((s) => s.format)).toEqual(['consultation', 'webinar']);
    expect(seededSampleCallSessions().map((s) => s.id)).toEqual([
      'call_session_sample_consultation',
      'call_session_sample_webinar',
    ]);
    const webinar = sampleCallSessionRows(seededSampleCallSessions()[1]!);
    expect(webinar.session).toMatchObject({ format: 'WEBINAR', webinarId: 'webinar_sample_ended', appointmentId: null });
    expect(webinar.participants.map((p) => p.role)).toEqual(['PRESENTER', 'MODERATOR', 'ATTENDEE', 'ATTENDEE']);
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

describe('sample webinars (T-CW-2.1)', () => {
  it('stores title and description per locale and maps the audience to the contract policy', () => {
    const [upcoming, ended] = SAMPLE_WEBINARS.map(sampleWebinarRows);
    expect(upcoming!.webinar).toMatchObject({ orgId: null, status: 'PUBLISHED', audiencePolicy: { type: 'all_eligible' } });
    expect(ended!.webinar).toMatchObject({
      orgId: 'org_sample',
      status: 'ENDED',
      audiencePolicy: { type: 'organization', orgIds: ['org_sample'] },
    });
    for (const rows of [upcoming!, ended!]) {
      expect(WebinarLocalizedTextSchema.safeParse(rows.webinar.title).success).toBe(true);
      expect(WebinarAudiencePolicySchema.safeParse(rows.webinar.audiencePolicy).success).toBe(true);
      // Every webinar is recorded (D-CW-34): there is no recording switch to seed.
      expect(Object.keys(rows.webinar)).not.toContain('recordingPolicy');
      // The org-less occurrence is moderated by the platform administrator (a platform-scoped event.moderate).
      expect(rows.hosts.map((h) => [h.userId, h.role])).toEqual([
        ['user_milica', 'PRESENTER'],
        [rows.webinar.orgId === null ? 'user_admin' : 'user_nikola', 'MODERATOR'],
      ]);
      expect(rows.presenterAssignments).toEqual([
        expect.objectContaining({ userId: 'user_milica', kind: 'CASE', targetId: rows.webinar.id, reason: 'webinar_presenter' }),
      ]);
    }
    // The attendees of the ended session are its registrants; a registration records the poll, not the option.
    expect(ended!.registrations.map((r) => [r.userId, r.votedPollIds])).toEqual([
      ['user_jovan', ['webinar_poll_sample']],
      ['user_ana', ['webinar_poll_sample']],
    ]);
    expect(upcoming!.registrations).toEqual([]);
  });

  it('keeps chat authors anonymous unless they attached the first name (D-CW-35)', () => {
    const rows = SAMPLE_WEBINAR_MESSAGES.map(sampleWebinarMessageRow);
    expect(rows.map((r) => [r.kind, r.status, r.authorFirstName, r.showFirstName])).toEqual([
      ['HOST', 'PUBLISHED', 'Nikola', false],
      ['ATTENDEE', 'PUBLISHED', 'Jovan', true],
      ['HOST', 'PUBLISHED', 'Milica', false],
      ['QUESTION', 'ANSWERED', null, false],
      ['ATTENDEE', 'PENDING', null, false],
    ]);
    expect(rows.map((r) => r.authorUserId)).toEqual(['user_nikola', 'user_jovan', 'user_milica', 'user_ana', 'user_ana']);
    expect(rows[3]).toMatchObject({ answeredByUserId: 'user_milica', publishedByUserId: 'user_nikola' });
    expect(rows[4]).toMatchObject({ publishedAt: null, publishedByUserId: null });
  });

  it('seeds one vote row per counted vote, none naming a voter (CW-R-24)', () => {
    const { poll, options, votes } = sampleWebinarPollRows(SAMPLE_WEBINAR_POLLS[0]!);
    expect(poll).toMatchObject({ id: 'webinar_poll_sample', createdByUserId: 'user_nikola', orgId: 'org_sample' });
    expect(options).toHaveLength(3);
    expect(votes.map((v) => v.optionId)).toEqual(['webinar_poll_option_sample_1', 'webinar_poll_option_sample_2']);
    for (const vote of votes) expect(Object.keys(vote).sort()).toEqual(['id', 'optionId', 'orgId', 'pollId']);
  });
});

describe('sample follow-up approval (T-CW-1.5)', () => {
  it('routes the awaiting_approval item to the sample approver in the employee\'s unit', () => {
    const rows = sampleApprovalRows('team_product');
    expect(rows.authorities).toEqual([
      {
        id: 'approval_authority_sample_ivana',
        userId: 'user_ivana',
        orgId: 'org_sample',
        orgUnitId: 'ou_root',
        includeDescendants: true,
        categories: [],
        alternateUserId: null,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    expect(rows.approvals).toEqual([
      {
        id: 'approval_sample_follow_up_awaiting',
        appointmentId: 'appt_sample_follow_up_awaiting',
        orgId: 'org_sample',
        orgUnitId: 'team_product',
        approverUserId: 'user_ivana',
        alternateUserId: null,
        status: 'PENDING',
      },
    ]);
  });
});
