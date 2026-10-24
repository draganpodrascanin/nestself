/**
 * Call sessions (NS-CALLS-01, T-CW-1.1, D-CW-25): the real-time session of
 * an appointment (and later of a webinar occurrence or workshop), its
 * participants, the provider's events, the client's telemetry, the delivery
 * outcome, the employee's feedback and the consent schema.
 *
 * Tenancy: every table carries `org_id` (the employee's organization for
 * consultations, copied from the session) under forced RLS with
 * `tenantPredicate`. The column is nullable because a webinar open to every
 * eligible organization has no organization (D-CW-25); such rows stay
 * visible in every tenant context, like platform grants. A consultation
 * session always has one (`call_sessions_consultation_check`).
 *
 * Enum values are UPPER_CASE; `call-mapper.ts` maps them to the lower-case
 * contract spellings (CW-R-19a). Nothing here stores a join token: the
 * credentials live in Redis only (D-CW-08, CW-R-13).
 *
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md section 5.1
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import {
  callConsentType,
  callFormat,
  callOutcomeStatus,
  callParticipantRole,
  callSessionEndReason,
  callSessionStatus,
} from './enums.js';
import { users } from './identity.js';
import { organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, ts, updatedAt } from './_shared.js';

/** Tenant isolation on `org_id`; a null organization is a platform-wide row (webinars open to all). */
function tenantIsolation(name: string, orgId: AnyPgColumn) {
  const predicate: SQL = tenantPredicate(orgId, { nullable: true });
  return pgPolicy(name, { for: 'all', using: predicate, withCheck: predicate });
}

/** `org_id` referencing the organization, nullable (see the header). */
const orgIdColumn = () => text().references(() => organizations.id, { onDelete: 'restrict' });

export const callSessions = pgTable(
  'call_sessions',
  {
    id: idColumn(),
    appointmentId: text().references(() => appointments.id, { onDelete: 'restrict' }),
    /** The `webinars` table and its foreign key arrive with T-CW-2.1. */
    webinarId: text(),
    orgId: orgIdColumn(),
    format: callFormat().notNull(),
    /** Set once `CreateMeeting` succeeds (CW-R-20). */
    providerMeetingId: text(),
    status: callSessionStatus().notNull().default('PENDING'),
    /** Scheduled window, copied from the appointment or the occurrence. */
    startsAt: ts().notNull(),
    endsAt: ts().notNull(),
    /** Set on the move to ACTIVE. */
    startedAt: ts(),
    /** Set on the move to ENDED. */
    endedAt: ts(),
    /**
     * What closed the session (T-CW-1.2): stamped before the provider call by
     * whoever ends it (`EXPERT`, `CLEANUP`, `RECONCILE`), so a `MeetingEnded`
     * event that wins the race keeps it; `PROVIDER` when Chime ended the
     * meeting on its own. Null while the session is open.
     */
    endReason: callSessionEndReason(),
    /**
     * Optional crisis-readiness location the employee shares before a
     * psychological consultation; cleared when the session ends (CALL-34,
     * CW-R-80a). Never audited, logged or shown in diagnostics.
     */
    locationText: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live session per appointment. A FAILED one stays for diagnostics and the next join starts
    // another; so does one the provider ended on its own, so a join inside the window can reopen the
    // room (T-CW-1.2). An expert, cleanup or reconcile end still blocks a second session.
    uniqueIndex('call_sessions_appointment_id_live_idx')
      .on(t.appointmentId)
      .where(sql`status <> 'FAILED' AND end_reason IS DISTINCT FROM 'PROVIDER'`),
    uniqueIndex('call_sessions_provider_meeting_id_idx').on(t.providerMeetingId),
    index('call_sessions_webinar_id_idx').on(t.webinarId),
    // calls.reconcile: ACTIVE sessions whose room should have closed (T-CW-1.2).
    index('call_sessions_status_ends_at_idx').on(t.status, t.endsAt),
    check('call_sessions_ends_after_starts_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'call_sessions_consultation_check',
      sql`${t.format} <> 'CONSULTATION' OR (${t.appointmentId} IS NOT NULL AND ${t.orgId} IS NOT NULL)`,
    ),
    check('call_sessions_webinar_check', sql`${t.format} <> 'WEBINAR' OR ${t.webinarId} IS NOT NULL`),
    tenantIsolation('call_sessions_tenant_isolation', t.orgId),
  ],
).enableRLS();

export const callParticipants = pgTable(
  'call_participants',
  {
    /** Random per session and person; the provider's `ExternalUserId` (D-CW-11, CW-R-22c). */
    id: idColumn(),
    sessionId: text()
      .notNull()
      .references(() => callSessions.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: callParticipantRole().notNull(),
    providerAttendeeId: text(),
    firstJoinedAt: ts(),
    lastLeftAt: ts(),
    reconnectCount: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('call_participants_session_id_user_id_idx').on(t.sessionId, t.userId),
    index('call_participants_user_id_idx').on(t.userId),
    index('call_participants_provider_attendee_id_idx').on(t.providerAttendeeId),
    check('call_participants_reconnect_count_check', sql`${t.reconnectCount} >= 0`),
    tenantIsolation('call_participants_tenant_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Raw provider events (D-CW-12). The dedup key treats a null attendee as a
 * value (`NULLS NOT DISTINCT`), so a repeated meeting-level event such as
 * `MeetingEnded` is dropped as well (CW-R-22a).
 */
export const callEvents = pgTable(
  'call_events',
  {
    id: idColumn(),
    sessionId: text()
      .notNull()
      .references(() => callSessions.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
    providerMeetingId: text().notNull(),
    eventType: text().notNull(),
    providerAttendeeId: text(),
    occurredAt: ts().notNull(),
    payload: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('call_events_dedup_idx')
      .on(t.providerMeetingId, t.eventType, t.providerAttendeeId, t.occurredAt)
      .nullsNotDistinct(),
    index('call_events_session_id_idx').on(t.sessionId),
    tenantIsolation('call_events_tenant_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Client telemetry (D-CW-13, CW-R-22b): metrics, device error names, browser
 * and OS only; never device labels, names or content. Retention 90 days.
 */
export const callClientEvents = pgTable(
  'call_client_events',
  {
    id: idColumn(),
    sessionId: text()
      .notNull()
      .references(() => callSessions.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
    participantId: text()
      .notNull()
      .references(() => callParticipants.id, { onDelete: 'restrict' }),
    eventName: text().notNull(),
    durationMs: integer(),
    /** `{ rtt, jitter, packetLoss, outgoingBitrate }` (CallQualityMetrics). */
    metrics: jsonb(),
    deviceError: text(),
    browser: text(),
    os: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('call_client_events_session_id_created_at_idx').on(t.sessionId, t.createdAt),
    index('call_client_events_participant_id_idx').on(t.participantId),
    tenantIsolation('call_client_events_tenant_isolation', t.orgId),
  ],
).enableRLS();

/** Delivery outcome: status and connection metadata only, no free text (CW-R-21, D-22). */
export const callOutcomes = pgTable(
  'call_outcomes',
  {
    id: idColumn(),
    sessionId: text()
      .notNull()
      .references(() => callSessions.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
    status: callOutcomeStatus().notNull(),
    recordedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Aggregated from `call_client_events`: duration, reconnect count, quality averages. */
    connectionMetrics: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('call_outcomes_session_id_idx').on(t.sessionId),
    tenantIsolation('call_outcomes_tenant_isolation', t.orgId),
  ],
).enableRLS();

/** The employee's private feedback: never shown to the employer or the expert (CW-R-22, UX-22). */
export const callFeedback = pgTable(
  'call_feedback',
  {
    id: idColumn(),
    sessionId: text()
      .notNull()
      .references(() => callSessions.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    score: integer().notNull(),
    comment: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('call_feedback_session_id_user_id_idx').on(t.sessionId, t.userId),
    check('call_feedback_score_check', sql`${t.score} BETWEEN 1 AND 5`),
    check('call_feedback_comment_length_check', sql`char_length(${t.comment}) <= 2000`),
    tenantIsolation('call_feedback_tenant_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Recording and transcription consent per participant. Schema only: no code
 * path writes it until consultations may be recorded (D-CW-19, D-CW-34,
 * CW-R-79b).
 */
export const callConsents = pgTable(
  'call_consents',
  {
    id: idColumn(),
    sessionId: text()
      .notNull()
      .references(() => callSessions.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
    participantId: text()
      .notNull()
      .references(() => callParticipants.id, { onDelete: 'restrict' }),
    consentType: callConsentType().notNull(),
    givenAt: ts().notNull(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('call_consents_session_id_idx').on(t.sessionId),
    tenantIsolation('call_consents_tenant_isolation', t.orgId),
  ],
).enableRLS();
