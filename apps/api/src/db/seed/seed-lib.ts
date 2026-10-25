/**
 * Seed logic, extracted so that tests can import and run it.
 * The thin runner (scripts/seed.ts) opens a pool and calls seed(db).
 *
 * Idempotent: every write is an upsert keyed on a stable id from
 * `@nestself/sample-data` (sample-data rule). Runs in system context (no RLS
 * tenant setting), as the migration/owner role.
 */
import { count, eq, inArray } from 'drizzle-orm';
import {
  SAMPLE_ORG,
  SAMPLE_TEAMS,
  SAMPLE_PEOPLE,
  SAMPLE_CHANNELS,
  SAMPLE_POSTS,
  SAMPLE_POLLS,
  SAMPLE_EXPERTS,
  SAMPLE_CONTENT,
  SAMPLE_ORG_UNITS,
  SAMPLE_EXPERT_CREDENTIALS,
  SAMPLE_EXTERNAL_IDENTITIES,
  SAMPLE_CASE,
  SAMPLE_APPOINTMENTS,
  SAMPLE_CALL_SESSIONS,
  SAMPLE_WEBINARS,
  SAMPLE_WEBINAR_MESSAGES,
  SAMPLE_WEBINAR_POLLS,
  SAMPLE_APPROVAL_AUTHORITIES,
  SAMPLE_APPROVAL_ITEMS,
  SAMPLE_APPROVER_USER_ID,
  type SampleAppointment,
  type SampleCallSession,
  type SampleWebinar,
  type SampleWebinarMessage,
  type SampleWebinarPoll,
} from '@nestself/sample-data';
// Calls and webinars: SAMPLE_APPOINTMENTS and both entries of
// SAMPLE_CALL_SESSIONS (call_sessions, call_participants, call_outcomes,
// call_feedback, T-CW-1.1), and SAMPLE_WEBINARS, SAMPLE_WEBINAR_MESSAGES and
// SAMPLE_WEBINAR_POLLS (T-CW-2.1), and the sample approver's authority and
// pending item (SAMPLE_APPROVAL_AUTHORITIES, SAMPLE_APPROVAL_ITEMS, T-CW-1.5)
// are seeded below.
import {
  PERMISSION_TEMPLATES,
  type PermissionTemplateDefinition,
  type WebinarAudiencePolicy,
} from '@nestself/contracts';
import { firstNameOf } from '../../appointments/appointment-mapper.js';
import {
  PRESENTER_ASSIGNMENT_REASON,
  toDbHostRole,
  toDbMessageKind,
  toDbMessageStatus,
  toDbWebinarStatus,
} from '../../webinars/webinar-mapper.js';
import { toDbAppointmentStatus } from '../../appointments/appointments.repository.js';
import {
  toDbFormat,
  toDbOutcomeStatus,
  toDbParticipantRole,
  toDbSessionStatus,
} from '../../calls/call-mapper.js';
import { RETENTION_POLICIES } from './retention-policies.js';
import { buildClosureRows } from '../../org-units/closure.js';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../db.service.js';
import * as t from '../schema/index.js';

/** A fixed date for sample startDate fields. */
const SAMPLE_START_DATE = new Date('2026-01-01T00:00:00Z');
const RETENTION_EFFECTIVE_FROM = new Date('2026-10-01T00:00:00Z');

type TableWithId = PgTable & { id: AnyPgColumn };

async function upsertById<TTable extends TableWithId>(
  db: Database,
  table: TTable,
  values: TTable['$inferInsert'],
  update: Partial<TTable['$inferInsert']>,
): Promise<void> {
  await db
    .insert(table)
    .values(values)
    .onConflictDoUpdate({ target: table.id, set: update as never });
}

/**
 * Templates granted explicitly on top of the legacy-role mapping, keyed by
 * person id. The sample HR admin doubles as the employer administrator, so
 * she also holds the employer owner template (mirrors
 * `SAMPLE_PRINCIPALS.hr_admin` and `grant_user_ivana_employer_owner` in
 * `@nestself/sample-data`). The backfill never derives these.
 */
export const EXTRA_SAMPLE_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  // The approver template makes her the sample follow-up approver (T-CW-1.5).
  user_ivana: ['employer_owner', 'approver'],
};

/** Ids of the grants created from `EXTRA_SAMPLE_TEMPLATES`. */
export const extraSampleGrantIds = (): string[] =>
  Object.entries(EXTRA_SAMPLE_TEMPLATES).flatMap(([personId, keys]) =>
    keys.map((key) => `grant_${personId}_${key}`),
  );

const upperRole = <T extends string>(role: string | null | undefined): T | null =>
  role ? (role.toUpperCase() as T) : null;

export async function seed(db: Database): Promise<Record<string, number>> {
  // ── Organisation ──
  await upsertById(
    db,
    t.organizations,
    {
      id: SAMPLE_ORG.id,
      name: SAMPLE_ORG.name,
      slug: SAMPLE_ORG.slug,
      country: 'RS',
      timezone: 'Europe/Belgrade',
      status: 'ACTIVE',
    },
    { name: SAMPLE_ORG.name, slug: SAMPLE_ORG.slug },
  );

  // ── Legacy teams (legacy_teams table) ──
  for (const team of SAMPLE_TEAMS) {
    await upsertById(
      db,
      t.legacyTeams,
      { id: team.id, name: team.name, orgId: team.orgId },
      { name: team.name },
    );
  }

  // ── Org units (parents before children; fixtures are ordered that way) ──
  for (const ou of SAMPLE_ORG_UNITS) {
    await upsertById(
      db,
      t.orgUnits,
      { id: ou.id, orgId: ou.orgId, parentId: ou.parentId, kind: ou.kind, name: ou.name },
      { name: ou.name, kind: ou.kind, parentId: ou.parentId },
    );
  }

  // ── Closure table (AUTHZ-R-09: every node is its own ancestor at depth 0) ──
  const closureRows = buildClosureRows(
    SAMPLE_ORG_UNITS.map((u) => ({ id: u.id, parentId: u.parentId })),
  );
  for (const row of closureRows) {
    await db
      .insert(t.orgUnitClosure)
      .values(row)
      .onConflictDoUpdate({
        target: [t.orgUnitClosure.ancestorId, t.orgUnitClosure.descendantId],
        set: { depth: row.depth },
      });
  }

  // ── Users and memberships ──
  // Team org units share ids with the legacy teams (by design, see fixtures).
  const defaultTeamId = SAMPLE_TEAMS[0]?.id ?? null;
  const hrAdmin = SAMPLE_PEOPLE.find((p) => p.orgRole === 'hr_admin');

  for (const person of SAMPLE_PEOPLE) {
    await upsertById(
      db,
      t.users,
      {
        id: person.id,
        email: `${person.id}@example.com`,
        displayName: person.displayName,
        locale: 'sr-Latn',
      },
      { displayName: person.displayName },
    );

    // The org role is no longer stored: it only selects the templates below.
    if (person.orgId && person.orgRole) {
      await db
        .insert(t.memberships)
        .values({
          userId: person.id,
          orgId: person.orgId,
          status: 'ACTIVE',
          startDate: SAMPLE_START_DATE,
          orgUnitId: defaultTeamId,
          teamId: defaultTeamId,
        })
        .onConflictDoUpdate({
          target: [t.memberships.userId, t.memberships.orgId, t.memberships.startDate],
          set: { status: 'ACTIVE', orgUnitId: defaultTeamId },
        });
    }
  }

  // ── External identities (fake pool subjects, D-04) ──
  for (const identity of SAMPLE_EXTERNAL_IDENTITIES) {
    await db
      .insert(t.externalIdentities)
      .values({
        id: `ext_${identity.userId}`,
        userId: identity.userId,
        provider: identity.provider,
        subject: identity.subject,
        cognitoUsername: identity.cognitoUsername,
        email: identity.email,
        emailVerified: true,
      })
      .onConflictDoUpdate({
        target: [t.externalIdentities.provider, t.externalIdentities.subject],
        set: { email: identity.email, cognitoUsername: identity.cognitoUsername },
      });
  }

  // ── Channels and posts ──
  for (const ch of SAMPLE_CHANNELS) {
    const scope = ch.scope === 'org' ? 'ORGANIZATION' : 'TEAM';
    await upsertById(
      db,
      t.channels,
      {
        id: ch.id,
        name: ch.name,
        scope,
        orgId: ch.orgId,
        teamId: 'teamId' in ch ? (ch as { teamId: string }).teamId : null,
      },
      { name: ch.name, scope },
    );
  }
  for (const post of SAMPLE_POSTS) {
    await upsertById(
      db,
      t.posts,
      { id: post.id, body: post.content, channelId: post.channelId, authorId: post.authorId },
      { body: post.content },
    );
  }

  // ── Polls ──
  for (const poll of SAMPLE_POLLS) {
    await upsertById(
      db,
      t.polls,
      { id: poll.id, question: poll.title, teamId: poll.teamId },
      { question: poll.title },
    );
    for (const opt of poll.options) {
      await upsertById(
        db,
        t.pollOptions,
        { id: opt.id, label: opt.label, pollId: poll.id },
        { label: opt.label },
      );
    }
  }

  // ── Experts and credentials ──
  const seededExpertIds = new Set<string>();
  for (const e of SAMPLE_EXPERTS) {
    const area = e.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    const user = SAMPLE_PEOPLE.find((p) => p.initials === e.initials);
    if (!user) continue;
    await upsertById(
      db,
      t.experts,
      { id: e.id, userId: user.id, area, languages: ['sr'] },
      { area },
    );
    seededExpertIds.add(e.id);
  }
  // Only for experts that were seeded (some fixtures lack a matching person).
  for (const ec of SAMPLE_EXPERT_CREDENTIALS) {
    if (!seededExpertIds.has(ec.expertId)) continue;
    await upsertById(
      db,
      t.expertCredentials,
      {
        id: ec.id,
        expertId: ec.expertId,
        serviceCategory: ec.serviceCategory,
        status: ec.status,
        effectiveFrom: SAMPLE_START_DATE,
      },
      { status: ec.status },
    );
  }

  // ── Content ──
  for (const c of SAMPLE_CONTENT) {
    const area = c.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    await upsertById(
      db,
      t.contentItems,
      {
        id: c.id,
        title: c.title,
        summary: c.summary,
        body: c.summary,
        kind: 'ARTICLE',
        area,
        locale: c.locale,
      },
      { title: c.title, summary: c.summary },
    );
  }

  // ── Retention policies (deterministic ids; unique keys match the ids) ──
  for (const rp of RETENTION_POLICIES) {
    const id = `rp_${rp.dataCategory}_${rp.jurisdiction}_${rp.serviceType ?? 'none'}`;
    await upsertById(
      db,
      t.retentionPolicies,
      {
        id,
        dataCategory: rp.dataCategory,
        jurisdiction: rp.jurisdiction,
        serviceType: rp.serviceType,
        minDays: rp.minDays,
        maxDays: rp.maxDays,
        legalBasis: rp.legalBasis,
        effectiveFrom: RETENTION_EFFECTIVE_FROM,
      },
      { minDays: rp.minDays, maxDays: rp.maxDays, legalBasis: rp.legalBasis },
    );
  }

  // ── Permission templates (from @nestself/contracts) ──
  for (const tmpl of PERMISSION_TEMPLATES) {
    const values = {
      key: tmpl.key,
      name: tmpl.name,
      workspace: tmpl.workspace,
      population: tmpl.population,
      actions: [...tmpl.actions],
      scopeType: tmpl.scopeType,
      defaultConditions: tmpl.defaultConditions ? [...tmpl.defaultConditions] : null,
      requiresSecondFactor: tmpl.requiresSecondFactor,
      stepUpActions: [...tmpl.stepUpActions],
      isActive: tmpl.isActive,
    };
    await db
      .insert(t.permissionTemplates)
      .values({ id: `tmpl_${tmpl.key}`, ...values })
      .onConflictDoUpdate({ target: t.permissionTemplates.key, set: values });
  }

  // Seeds before the legacy-role fix (57bfd4f) also granted every sample person
  // the templates without a legacy role (employer_owner, approver, ...). Remove
  // those derived rows from databases seeded back then; explicitly created
  // grants have other ids and stay.
  const unmappedTemplateKeys = PERMISSION_TEMPLATES.filter((tmpl) => tmpl.legacyRole == null).map(
    (tmpl) => tmpl.key,
  );
  const extraGrantIds = new Set(extraSampleGrantIds());
  await db.delete(t.grants).where(
    inArray(
      t.grants.id,
      SAMPLE_PEOPLE.flatMap((p) => unmappedTemplateKeys.map((key) => `grant_${p.id}_${key}`)).filter(
        (id) => !extraGrantIds.has(id),
      ),
    ),
  );

  // ── Grants derived from the legacy roles ──
  for (const person of SAMPLE_PEOPLE) {
    const legacyRole = upperRole<string>(person.orgRole);
    const platformRole = upperRole<string>(person.platformRole);
    // Platform staff and experts have no employer membership but still get
    // grants from their staff or expert template.
    if (!person.orgId && !platformRole) continue;

    const extraTemplates = (EXTRA_SAMPLE_TEMPLATES[person.id] ?? []).map((key) => {
      const tmpl = PERMISSION_TEMPLATES.find((candidate) => candidate.key === key);
      if (!tmpl) throw new Error(`EXTRA_SAMPLE_TEMPLATES names an unknown template: ${key}`);
      return tmpl;
    });

    for (const tmpl of [...templatesForLegacyRoles(legacyRole, platformRole), ...extraTemplates]) {
      const scope = resolveSampleScope(tmpl.scopeType, person.orgId ?? null, defaultTeamId);
      const update = {
        actions: [...tmpl.actions],
        scopeType: tmpl.scopeType,
        ...scope,
        conditions: await derivedGrantConditions(db, tmpl, person.id),
      };
      await db
        .insert(t.grants)
        .values({
          id: `grant_${person.id}_${tmpl.key}`,
          subjectUserId: person.id,
          templateKey: tmpl.key,
          grantedByUserId: hrAdmin?.id ?? person.id,
          grantedAt: SAMPLE_START_DATE,
          validFrom: SAMPLE_START_DATE,
          ...update,
        })
        .onConflictDoUpdate({ target: t.grants.id, set: update });
    }

    // Operations staff: CLIENT assignment to the sample organization.
    if (platformRole === 'OPERATIONS') {
      await db
        .insert(t.assignments)
        .values({
          id: `assignment_${person.id}_client_${SAMPLE_ORG.id}`,
          userId: person.id,
          kind: 'CLIENT',
          targetId: SAMPLE_ORG.id,
          assignedByUserId: hrAdmin?.id ?? person.id,
          startAt: SAMPLE_START_DATE,
        })
        .onConflictDoNothing({ target: t.assignments.id });
    }
  }

  // ── Confidential professional domain: one case (T-2.4) ──
  // The expert reaches the case through a CASE assignment targeting its id.
  await db
    .insert(t.assignments)
    .values({
      id: `assignment_${SAMPLE_CASE.expertUserId}_case_${SAMPLE_CASE.id}`,
      userId: SAMPLE_CASE.expertUserId,
      kind: 'CASE',
      targetId: SAMPLE_CASE.id,
      assignedByUserId: hrAdmin?.id ?? SAMPLE_CASE.expertUserId,
      startAt: SAMPLE_START_DATE,
    })
    .onConflictDoNothing({ target: t.assignments.id });
  const caseRef = {
    orgId: SAMPLE_CASE.orgId,
    caseId: SAMPLE_CASE.id,
    employeeUserId: SAMPLE_CASE.employeeUserId,
  };
  await upsertById(
    db,
    t.conversations,
    { id: SAMPLE_CASE.conversation.id, ...caseRef, expertUserId: SAMPLE_CASE.expertUserId },
    { ...caseRef, expertUserId: SAMPLE_CASE.expertUserId },
  );
  for (const m of SAMPLE_CASE.conversation.messages) {
    await upsertById(
      db,
      t.conversationMessages,
      {
        id: m.id,
        conversationId: SAMPLE_CASE.conversation.id,
        authorUserId: m.authorUserId,
        body: m.body,
        createdAt: new Date(m.createdAt),
      },
      { body: m.body },
    );
  }
  await upsertById(
    db,
    t.intakeRecords,
    {
      id: SAMPLE_CASE.intake.id,
      ...caseRef,
      body: SAMPLE_CASE.intake.body,
      createdAt: new Date(SAMPLE_CASE.intake.createdAt),
    },
    { body: SAMPLE_CASE.intake.body },
  );

  // ── Appointments (T-CW-0.6 table) with the expert's CASE assignment ──
  // The assignment is the one AppointmentsService.create adds: it lets the
  // expert reach the appointment through the expert template.
  for (const appointment of SAMPLE_APPOINTMENTS) {
    const row = sampleAppointmentRow(appointment);
    const { id: _id, ...update } = row;
    await upsertById(db, t.appointments, row, update);
    await db
      .insert(t.assignments)
      .values({
        id: `assignment_${row.expertUserId}_case_${row.id}`,
        userId: row.expertUserId,
        kind: 'CASE',
        targetId: row.id,
        assignedByUserId: hrAdmin?.id ?? row.expertUserId,
        startAt: SAMPLE_START_DATE,
        reason: 'appointment_expert',
      })
      .onConflictDoNothing({ target: t.assignments.id });
  }

  // ── Webinars (T-CW-2.1): occurrences, hosts with the presenters' CASE assignments, registrations ──
  for (const sample of SAMPLE_WEBINARS) {
    const rows = sampleWebinarRows(sample);
    const { id: _webinarId, ...webinarUpdate } = rows.webinar;
    await upsertById(db, t.webinars, rows.webinar, webinarUpdate);
    for (const host of rows.hosts) {
      const { id: _hostId, ...hostUpdate } = host;
      await upsertById(db, t.webinarHosts, host, hostUpdate);
    }
    for (const assignment of rows.presenterAssignments) {
      await db
        .insert(t.assignments)
        .values({ ...assignment, startAt: SAMPLE_START_DATE })
        .onConflictDoNothing({ target: t.assignments.id });
    }
    for (const registration of rows.registrations) {
      const { id: _registrationId, ...registrationUpdate } = registration;
      await upsertById(db, t.webinarRegistrations, registration, registrationUpdate);
    }
  }

  // ── Call sessions (T-CW-1.1): the ended consultation with its outcome and feedback, the ended webinar ──
  for (const sample of seededSampleCallSessions()) {
    const rows = sampleCallSessionRows(sample);
    const { id: _sessionId, ...sessionUpdate } = rows.session;
    await upsertById(db, t.callSessions, rows.session, sessionUpdate);
    for (const participant of rows.participants) {
      const { id: _participantId, ...participantUpdate } = participant;
      await upsertById(db, t.callParticipants, participant, participantUpdate);
    }
    if (rows.outcome) {
      const { id: _outcomeId, ...outcomeUpdate } = rows.outcome;
      await upsertById(db, t.callOutcomes, rows.outcome, outcomeUpdate);
    }
    for (const feedback of rows.feedback) {
      const { id: _feedbackId, ...feedbackUpdate } = feedback;
      await upsertById(db, t.callFeedback, feedback, feedbackUpdate);
    }
  }

  // ── Webinar chat and polls (T-CW-2.1): written in the webinar session, so after it ──
  for (const message of SAMPLE_WEBINAR_MESSAGES) {
    const row = sampleWebinarMessageRow(message);
    const { id: _messageId, ...messageUpdate } = row;
    await upsertById(db, t.webinarMessages, row, messageUpdate);
  }
  for (const sample of SAMPLE_WEBINAR_POLLS) {
    const rows = sampleWebinarPollRows(sample);
    const { id: _pollId, ...pollUpdate } = rows.poll;
    await upsertById(db, t.webinarPolls, rows.poll, pollUpdate);
    for (const option of rows.options) {
      const { id: _optionId, ...optionUpdate } = option;
      await upsertById(db, t.webinarPollOptions, option, optionUpdate);
    }
    for (const vote of rows.votes) {
      await db.insert(t.webinarPollResults).values(vote).onConflictDoNothing({ target: t.webinarPollResults.id });
    }
  }

  // ── Follow-up approval (T-CW-1.5): the sample approver's authority and pending item ──
  // After the appointments: the item references the awaiting_approval follow-up.
  const approvalRows = sampleApprovalRows(defaultTeamId);
  for (const authority of approvalRows.authorities) {
    const { id: _authorityId, ...authorityUpdate } = authority;
    await upsertById(db, t.approvalAuthorities, authority, authorityUpdate);
  }
  for (const approval of approvalRows.approvals) {
    const { id: _approvalId, ...approvalUpdate } = approval;
    await upsertById(db, t.appointmentApprovals, approval, approvalUpdate);
  }

  return countAll(db);
}

/**
 * The sample approver's `approval_authorities` rows and the pending
 * `appointment_approvals` row of each sample approval item, routed to that
 * approver in the employee's unit (`employeeUnitId`, the unit the seed gives
 * every sample membership).
 */
export function sampleApprovalRows(employeeUnitId: string | null) {
  const authorities = SAMPLE_APPROVAL_AUTHORITIES.map(
    (authority) =>
      ({
        id: authority.id,
        userId: authority.userId,
        orgId: authority.orgId,
        orgUnitId: authority.orgUnitId,
        includeDescendants: authority.includeDescendants,
        categories: [...authority.categories],
        alternateUserId: authority.alternateUserId,
        validFrom: new Date(authority.validFrom),
      }) satisfies typeof t.approvalAuthorities.$inferInsert,
  );
  const approvals = SAMPLE_APPROVAL_ITEMS.map((item) => {
    const appointment = SAMPLE_APPOINTMENTS.find((candidate) => candidate.id === item.appointmentId);
    if (!appointment) throw new Error(`SAMPLE_APPROVAL_ITEMS names an unknown appointment: ${item.appointmentId}`);
    return {
      id: item.id,
      appointmentId: item.appointmentId,
      orgId: appointment.orgId,
      orgUnitId: employeeUnitId,
      approverUserId: SAMPLE_APPROVER_USER_ID,
      alternateUserId: null,
      status: item.status.toUpperCase() as (typeof t.appointmentApprovalStatus.enumValues)[number],
    } satisfies typeof t.appointmentApprovals.$inferInsert;
  });
  return { authorities, approvals };
}

// ── Webinar fixtures (T-CW-2.1) ──────────────────────────────────────────────
// Note for the sample-data owners: `SampleWebinarStatus` in
// `packages/sample-data/src/fixtures/webinars.ts` duplicates the contract's
// `WebinarStatus` (it predates the webinar contracts); swap it for the
// contract type when that file is next changed.

/** The fixture's audience: `all_eligible`, or the id of the one organisation (D-CW-17). */
export function sampleAudiencePolicy(audience: string): WebinarAudiencePolicy {
  return audience === 'all_eligible' ? { type: 'all_eligible' } : { type: 'organization', orgIds: [audience] };
}

/** The sample person's first name, as an attendee would attach it (D-CW-35). */
function sampleFirstName(userId: string): string | null {
  return firstNameOf(SAMPLE_PEOPLE.find((person) => person.id === userId)?.displayName);
}

const sampleWebinar = (webinarId: string): SampleWebinar => {
  const webinar = SAMPLE_WEBINARS.find((w) => w.id === webinarId);
  if (!webinar) throw new Error(`sample webinar ${webinarId} is missing`);
  return webinar;
};

/** The sample webinar session's participants by id. */
function sampleParticipant(participantId: string): { userId: string; role: string } {
  for (const session of SAMPLE_CALL_SESSIONS) {
    const participant = session.participants.find((p) => p.id === participantId);
    if (participant) return participant;
  }
  throw new Error(`sample call participant ${participantId} is missing`);
}

const sampleModerator = (webinar: SampleWebinar) => webinar.hosts.find((host) => host.role === 'moderator')?.userId ?? null;
const samplePresenter = (webinar: SampleWebinar) => webinar.hosts.find((host) => host.role === 'presenter')?.userId ?? null;

/**
 * The rows of a sample occurrence. Title and description go in per locale
 * (`jsonb`, the contract's `WebinarLocalizedTextSchema`); the attendees of the
 * sample webinar session are its registrants, and each registration records
 * that it voted in the sample polls, never the option (CW-R-24).
 */
export function sampleWebinarRows(sample: SampleWebinar) {
  const webinar = {
    id: sample.id,
    orgId: sample.orgId,
    title: sample.title,
    description: sample.description,
    audiencePolicy: sampleAudiencePolicy(sample.audiencePolicy),
    capacity: sample.capacity,
    startsAt: new Date(sample.startsAt),
    endsAt: new Date(sample.endsAt),
    timeZone: sample.timeZone,
    status: toDbWebinarStatus(sample.status),
    chatPolicy: sample.chatPolicy,
    createdByUserId: sample.createdByUserId,
  } satisfies typeof t.webinars.$inferInsert;
  const hosts = sample.hosts.map(
    (host) =>
      ({
        id: `webinar_host_${sample.id}_${host.userId}`,
        webinarId: sample.id,
        orgId: sample.orgId,
        userId: host.userId,
        role: toDbHostRole(host.role),
        displayName: host.displayName,
      }) satisfies typeof t.webinarHosts.$inferInsert,
  );
  const presenterAssignments = sample.hosts
    .filter((host) => host.role === 'presenter')
    .map((host) => ({
      id: `assignment_${host.userId}_case_${sample.id}`,
      userId: host.userId,
      kind: 'CASE' as const,
      targetId: sample.id,
      assignedByUserId: sample.createdByUserId,
      reason: PRESENTER_ASSIGNMENT_REASON,
    }));
  const pollIds = SAMPLE_WEBINAR_POLLS.filter((poll) => poll.webinarId === sample.id).map((poll) => poll.id);
  const attendees = SAMPLE_CALL_SESSIONS.filter((session) => session.webinarId === sample.id).flatMap((session) =>
    session.participants.filter((participant) => participant.role === 'attendee'),
  );
  const registrations = [...new Set(attendees.map((attendee) => attendee.userId))].map(
    (userId) =>
      ({
        id: `webinar_registration_${sample.id}_${userId}`,
        webinarId: sample.id,
        // A registration always carries the registrant's organisation (migration 0013).
        orgId: SAMPLE_PEOPLE.find((person) => person.id === userId)?.orgId ?? SAMPLE_ORG.id,
        userId,
        registeredAt: new Date(new Date(sample.startsAt).getTime() - 7 * 24 * 60 * 60_000),
        votedPollIds: pollIds,
      }) satisfies typeof t.webinarRegistrations.$inferInsert,
  );
  return { webinar, hosts, presenterAssignments, registrations };
}

/**
 * A sample chat message: the author from the session's participant, the
 * first name only where the attendee attached it, the host's display name
 * on host posts, the moderator as publisher and the presenter as answerer.
 */
export function sampleWebinarMessageRow(message: SampleWebinarMessage) {
  const webinar = sampleWebinar(message.webinarId);
  const author = message.authorParticipantId ? sampleParticipant(message.authorParticipantId) : null;
  const authorUserId = author?.userId ?? sampleModerator(webinar) ?? webinar.createdByUserId;
  const host = webinar.hosts.find((h) => h.userId === authorUserId);
  const authorFirstName =
    message.kind === 'host' ? (host?.displayName ?? sampleFirstName(authorUserId)) : message.showFirstName ? sampleFirstName(authorUserId) : null;
  const published = message.status === 'published' || message.status === 'answered';
  return {
    id: message.id,
    webinarId: message.webinarId,
    orgId: webinar.orgId,
    sessionId: message.sessionId,
    authorParticipantId: message.authorParticipantId,
    authorUserId,
    kind: toDbMessageKind(message.kind),
    status: toDbMessageStatus(message.status),
    text: message.text,
    showFirstName: message.kind !== 'host' && authorFirstName !== null,
    authorFirstName,
    publishedAt: message.publishedAt ? new Date(message.publishedAt) : null,
    publishedByUserId: published ? (message.kind === 'host' ? authorUserId : sampleModerator(webinar)) : null,
    answerText: message.answerText,
    answeredByUserId: message.status === 'answered' ? samplePresenter(webinar) : null,
    createdAt: new Date(message.createdAt),
  } satisfies typeof t.webinarMessages.$inferInsert;
}

/** A sample poll with its options and one vote row per counted vote, none naming a voter (CW-R-24). */
export function sampleWebinarPollRows(sample: SampleWebinarPoll) {
  const webinar = sampleWebinar(sample.webinarId);
  const poll = {
    id: sample.id,
    webinarId: sample.webinarId,
    orgId: webinar.orgId,
    sessionId: sample.sessionId,
    question: sample.question,
    createdByUserId: sampleModerator(webinar) ?? webinar.createdByUserId,
    openedAt: new Date(sample.openedAt),
    closedAt: new Date(sample.closedAt),
  } satisfies typeof t.webinarPolls.$inferInsert;
  const options = sample.options.map(
    (option) =>
      ({ id: option.id, pollId: sample.id, orgId: webinar.orgId, label: option.label, position: option.position }) satisfies typeof t.webinarPollOptions.$inferInsert,
  );
  const votes = sample.results.flatMap((result) =>
    Array.from(
      { length: result.count },
      (_, n) =>
        ({ id: `${result.optionId}_vote_${n + 1}`, pollId: sample.id, optionId: result.optionId, orgId: webinar.orgId }) satisfies typeof t.webinarPollResults.$inferInsert,
    ),
  );
  return { poll, options, votes };
}

/** The `appointments` row of a sample appointment, with the UPPER_CASE status (CW-R-19a). */
export function sampleAppointmentRow(appointment: SampleAppointment): typeof t.appointments.$inferInsert & { id: string; expertUserId: string } {
  return {
    id: appointment.id,
    orgId: appointment.orgId,
    expertUserId: appointment.expertUserId,
    employeeUserId: appointment.employeeUserId,
    startsAt: new Date(appointment.startsAt),
    endsAt: new Date(appointment.endsAt),
    status: toDbAppointmentStatus(appointment.status),
    serviceCategory: appointment.serviceCategory,
    timeZone: appointment.timeZone,
    fundingRef: appointment.fundingRef,
    followUpOf: appointment.followUpOf,
  };
}

/**
 * The sample call sessions this seed writes: the consultation and, since the
 * webinars tables of T-CW-2.1, the session of the ended sample webinar.
 */
export function seededSampleCallSessions(): SampleCallSession[] {
  return [...SAMPLE_CALL_SESSIONS];
}

/** The rows of one sample call session, with the UPPER_CASE enums (CW-R-19a). */
export function sampleCallSessionRows(sample: SampleCallSession) {
  const orgId = sample.orgId;
  const session = {
    id: sample.id,
    appointmentId: sample.appointmentId,
    webinarId: sample.webinarId,
    orgId,
    format: toDbFormat(sample.format),
    providerMeetingId: sample.providerMeetingId,
    status: toDbSessionStatus(sample.status),
    startsAt: new Date(sample.startsAt),
    endsAt: new Date(sample.endsAt),
    startedAt: sample.startedAt ? new Date(sample.startedAt) : null,
    endedAt: sample.endedAt ? new Date(sample.endedAt) : null,
  } satisfies typeof t.callSessions.$inferInsert;
  const participants = sample.participants.map(
    (participant) =>
      ({
        id: participant.id,
        sessionId: sample.id,
        orgId,
        userId: participant.userId,
        role: toDbParticipantRole(participant.role),
        firstJoinedAt: participant.firstJoinedAt ? new Date(participant.firstJoinedAt) : null,
        lastLeftAt: participant.lastLeftAt ? new Date(participant.lastLeftAt) : null,
        reconnectCount: participant.reconnectCount,
      }) satisfies typeof t.callParticipants.$inferInsert,
  );
  const outcome = sample.outcome
    ? ({
        id: sample.outcome.id,
        sessionId: sample.id,
        orgId,
        status: toDbOutcomeStatus(sample.outcome.status),
        recordedByUserId: sample.outcome.recordedByUserId,
        connectionMetrics: sample.outcome.connectionMetrics,
      } satisfies typeof t.callOutcomes.$inferInsert)
    : null;
  const feedback = sample.feedback.map(
    (entry) =>
      ({
        id: entry.id,
        sessionId: sample.id,
        orgId,
        userId: entry.userId,
        score: entry.score,
        comment: entry.comment,
      }) satisfies typeof t.callFeedback.$inferInsert,
  );
  return { session, participants, outcome, feedback };
}

/**
 * The permission templates a legacy org role and platform role map to.
 * Templates without a legacy role (employer_owner, approver, ...) are never
 * derived: they are granted explicitly. Every org member also receives the
 * employee template. Roles are matched case-insensitively.
 */
export function templatesForLegacyRoles(
  orgRole: string | null,
  platformRole: string | null,
): PermissionTemplateDefinition[] {
  const org = orgRole?.toUpperCase() ?? null;
  const platform = platformRole?.toUpperCase() ?? null;
  const matching = PERMISSION_TEMPLATES.filter(
    (tmpl) => tmpl.legacyRole != null && (tmpl.legacyRole === org || tmpl.legacyRole === platform),
  );
  if (org && !matching.some((tmpl) => tmpl.key === 'employee')) {
    const employee = PERMISSION_TEMPLATES.find((tmpl) => tmpl.key === 'employee');
    if (employee) matching.push(employee);
  }
  return matching;
}

/**
 * Conditions a derived grant carries: the expert template is limited to the
 * expert's approved service categories. Null when there are none.
 */
export async function derivedGrantConditions(
  db: Database,
  tmpl: PermissionTemplateDefinition,
  userId: string,
): Promise<unknown[] | null> {
  if (tmpl.scopeType !== 'assigned_cases' || tmpl.key !== 'expert') return null;
  const expert = await db.query.experts.findFirst({
    where: eq(t.experts.userId, userId),
    with: { credentials: { where: eq(t.expertCredentials.status, 'APPROVED') } },
  });
  const categories = expert?.credentials.map((c) => c.serviceCategory) ?? [];
  return categories.length > 0 ? [{ type: 'categories', allowed: categories }] : null;
}

/** Grant scope columns for a template's scope type. */
export function resolveSampleScope(scopeType: string, orgId: string | null, defaultTeamId: string | null) {
  switch (scopeType) {
    case 'org_unit':
      return { scopeOrgId: orgId, scopeOrgUnitId: defaultTeamId, includeDescendants: true };
    case 'platform':
      return { scopeOrgId: null, scopeOrgUnitId: null, includeDescendants: false };
    default:
      // own, organization, assigned_cases and anything else: organization scope.
      return { scopeOrgId: orgId, scopeOrgUnitId: null, includeDescendants: false };
  }
}

async function countAll(db: Database): Promise<Record<string, number>> {
  const tables = {
    organizations: t.organizations,
    teams: t.legacyTeams,
    orgUnits: t.orgUnits,
    orgUnitClosures: t.orgUnitClosure,
    users: t.users,
    externalIdentities: t.externalIdentities,
    memberships: t.memberships,
    channels: t.channels,
    posts: t.posts,
    polls: t.polls,
    experts: t.experts,
    expertCredentials: t.expertCredentials,
    contentItems: t.contentItems,
    retentionPolicies: t.retentionPolicies,
    permissionTemplates: t.permissionTemplates,
    grants: t.grants,
    assignments: t.assignments,
    conversations: t.conversations,
    conversationMessages: t.conversationMessages,
    intakeRecords: t.intakeRecords,
    appointments: t.appointments,
    callSessions: t.callSessions,
    callParticipants: t.callParticipants,
    callOutcomes: t.callOutcomes,
    callFeedback: t.callFeedback,
    approvalAuthorities: t.approvalAuthorities,
    appointmentApprovals: t.appointmentApprovals,
    webinars: t.webinars,
    webinarHosts: t.webinarHosts,
    webinarRegistrations: t.webinarRegistrations,
    webinarMessages: t.webinarMessages,
    webinarPolls: t.webinarPolls,
    webinarPollOptions: t.webinarPollOptions,
    webinarPollResults: t.webinarPollResults,
  };
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table);
    counts[name] = row?.n ?? 0;
  }
  return counts;
}
