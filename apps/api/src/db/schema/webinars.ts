/**
 * Webinars (NS-CALLS-01, T-CW-2.1, D-CW-03, D-CW-14 to D-CW-18, D-CW-25,
 * D-CW-34, D-CW-35): the occurrence, its hosts, the registrations, the chat
 * (host posts, attendee messages and questions), polls with their options
 * and anonymous votes, and the recording pipeline state.
 *
 * Tenancy (D-CW-25, CW-R-23): every table carries `org_id` under forced RLS
 * with `tenantPredicate(org_id, { nullable: true })`. An occurrence for the
 * `all_eligible` audience, or for several organisations, has no organisation
 * (`org_id` null); its rows are visible in every tenant context, like
 * platform grants, so the audience policy is enforced by the service, never
 * by RLS alone. An organisation-scoped occurrence carries the organisation.
 * Child rows copy the occurrence's `org_id`, except a registration, which
 * carries the registrant's organisation: an employer session of another
 * organisation never reads it, even for an occurrence open to all.
 *
 * - No recording switch (D-CW-34): every webinar is recorded, so
 *   `webinars.recording_status` starts `SCHEDULED` and only the pipeline
 *   (T-CW-2.5) moves it.
 * - Title and description are stored per locale (`jsonb`, the contract's
 *   `WebinarLocalizedTextSchema`), and the audience policy as the contract's
 *   `WebinarAudiencePolicySchema` object (`jsonb`), so the eligibility filter
 *   of `GET /webinars` runs in SQL.
 * - Polls (D-CW-16, CW-R-24): `webinar_poll_results` holds one row per vote
 *   with the option and nothing about the voter, not even a timestamp. A
 *   registration records the polls it voted in
 *   (`webinar_registrations.voted_poll_ids`), never the option, which is how
 *   a second vote is refused without linking a vote to a person.
 * - Hand-raise and the floor (D-CW-15, D-CW-35) are per registration
 *   (`hand_raised_at`, `floor_given_at`); the floor is audio only and the
 *   capabilities live with the provider.
 *
 * Enum values are UPPER_CASE; `webinar-mapper.ts` maps them to the lower-case
 * contract spellings (CW-R-19a).
 *
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md section 5.2
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { WebinarAudiencePolicy, WebinarLocalizedText } from '@nestself/contracts';
import { callParticipants, callSessions } from './calls.js';
import {
  callParticipantRole,
  recordingStatus,
  webinarMessageKind,
  webinarMessageStatus,
  webinarStatus,
} from './enums.js';
import { users } from './identity.js';
import { organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, textArray, ts, updatedAt } from './_shared.js';

/** Tenant isolation on `org_id`; a null organization is a platform-wide row (an occurrence open to all). */
function tenantIsolation(name: string, orgId: AnyPgColumn) {
  const predicate: SQL = tenantPredicate(orgId, { nullable: true });
  return pgPolicy(name, { for: 'all', using: predicate, withCheck: predicate });
}

/** `org_id` referencing the organization, nullable (see the header). */
const orgIdColumn = () => text().references(() => organizations.id, { onDelete: 'restrict' });

/** `webinar_id` referencing the occurrence. */
const webinarIdColumn = () =>
  text()
    .notNull()
    .references(() => webinars.id, { onDelete: 'restrict' });

export const webinars = pgTable(
  'webinars',
  {
    id: idColumn(),
    /** Null for the `all_eligible` audience and for an occurrence of several organisations (CW-R-23). */
    orgId: orgIdColumn(),
    /** Per locale, at least one (`WebinarLocalizedTextSchema`). */
    title: jsonb().$type<WebinarLocalizedText>().notNull(),
    description: jsonb().$type<WebinarLocalizedText>(),
    /** `WebinarAudiencePolicySchema`: `all_eligible`, organisations, or organisational units of one organisation. */
    audiencePolicy: jsonb().$type<WebinarAudiencePolicy>().notNull(),
    capacity: integer().notNull().default(250),
    startsAt: ts().notNull(),
    endsAt: ts().notNull(),
    timeZone: text().notNull(),
    status: webinarStatus().notNull().default('DRAFT'),
    /** Every webinar is recorded (D-CW-34); the pipeline (T-CW-2.5) moves it. */
    recordingStatus: recordingStatus().notNull().default('SCHEDULED'),
    /** The moderated chat of D-CW-35 is the only policy. */
    chatPolicy: text().notNull().default('moderated'),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Set on the move to LIVE (`POST /webinars/:id/start`). */
    startedAt: ts(),
    /** Set on the move to ENDED (`POST /webinars/:id/end`). */
    endedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('webinars_status_starts_at_idx').on(t.status, t.startsAt, t.id),
    index('webinars_org_id_idx').on(t.orgId),
    check('webinars_ends_after_starts_check', sql`${t.endsAt} > ${t.startsAt}`),
    // 250 until media replication lands in M3 is the service's rule (D-CW-36); 1,000 is the documented ceiling (D-CW-14).
    check('webinars_capacity_check', sql`${t.capacity} BETWEEN 1 AND 1000`),
    check('webinars_chat_policy_check', sql`${t.chatPolicy} = 'moderated'`),
    tenantIsolation('webinars_tenant_isolation', t.orgId),
  ],
).enableRLS();

/** The presenters and the moderator of an occurrence; `display_name` is what attendees see for presenters. */
export const webinarHosts = pgTable(
  'webinar_hosts',
  {
    id: idColumn(),
    webinarId: webinarIdColumn(),
    orgId: orgIdColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: callParticipantRole().notNull(),
    displayName: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('webinar_hosts_webinar_id_user_id_idx').on(t.webinarId, t.userId),
    // One moderator per occurrence.
    uniqueIndex('webinar_hosts_moderator_idx').on(t.webinarId).where(sql`role = 'MODERATOR'`),
    index('webinar_hosts_user_id_idx').on(t.userId),
    check('webinar_hosts_role_check', sql`${t.role} IN ('PRESENTER', 'MODERATOR')`),
    tenantIsolation('webinar_hosts_tenant_isolation', t.orgId),
  ],
).enableRLS();

/**
 * One row per person and occurrence (CW-R-24a). Unregistering sets
 * `canceled_at`; registering again clears it. Active registrations
 * (`canceled_at` null) count against the capacity (CW-R-31).
 */
export const webinarRegistrations = pgTable(
  'webinar_registrations',
  {
    id: idColumn(),
    webinarId: webinarIdColumn(),
    /**
     * The registrant's organisation: the membership that made them eligible.
     * Never null, so a registration is visible only in its organisation's
     * tenant scope (and the system context), even for an occurrence open to
     * all (migration 0013).
     */
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    registeredAt: ts().notNull(),
    /** Attendance summary for certificates and reports (T-CW-3.3); live attendance is read from `call_participants`. */
    joinedAt: ts(),
    leftAt: ts(),
    attendedMinutes: integer(),
    canceledAt: ts(),
    /** Set while the attendee's hand is raised (WBN-10). */
    handRaisedAt: ts(),
    /** Set while a host has given the attendee the floor: audio `SendReceive`, video `Receive` (D-CW-35). */
    floorGivenAt: ts(),
    /** Polls this registration voted in; never the option chosen (CW-R-24). */
    votedPollIds: textArray(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('webinar_registrations_user_idx').on(t.webinarId, t.userId),
    index('webinar_registrations_user_id_idx').on(t.userId),
    check('webinar_registrations_attended_minutes_check', sql`${t.attendedMinutes} IS NULL OR ${t.attendedMinutes} >= 0`),
    pgPolicy('webinar_registrations_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * The chat (D-CW-35, CW-R-103, CW-R-104): host posts are PUBLISHED at once;
 * attendee messages and questions start PENDING and reach the audience only
 * when a host publishes or answers them. `author_first_name` is set only when
 * the attendee attached it (anonymous by default), or to the host's display
 * name for a host post. `author_user_id` serves the moderator's view and
 * never leaves the moderation room. `original_text` keeps the attendee's
 * words when the moderator edited them before publishing (WBN-24).
 */
export const webinarMessages = pgTable(
  'webinar_messages',
  {
    id: idColumn(),
    webinarId: webinarIdColumn(),
    orgId: orgIdColumn(),
    /** The live session the message was written in; null before the first host joined. */
    sessionId: text().references(() => callSessions.id, { onDelete: 'restrict' }),
    /** Null for a host post by a moderator who has not joined the meeting. */
    authorParticipantId: text().references(() => callParticipants.id, { onDelete: 'restrict' }),
    /**
     * Null once the author link is removed, 12 months after the occurrence
     * (D-CW-29, guidelines 16.3); every message is written with its author.
     */
    authorUserId: text().references(() => users.id, { onDelete: 'restrict' }),
    kind: webinarMessageKind().notNull(),
    status: webinarMessageStatus().notNull().default('PENDING'),
    text: text().notNull(),
    originalText: text(),
    showFirstName: boolean().notNull().default(false),
    authorFirstName: text(),
    publishedAt: ts(),
    publishedByUserId: text().references(() => users.id, { onDelete: 'restrict' }),
    answerText: text(),
    answeredByUserId: text().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('webinar_messages_webinar_id_created_at_idx').on(t.webinarId, t.createdAt, t.id),
    check('webinar_messages_text_length_check', sql`char_length(${t.text}) BETWEEN 1 AND 1000`),
    check(
      'webinar_messages_original_text_length_check',
      sql`${t.originalText} IS NULL OR char_length(${t.originalText}) BETWEEN 1 AND 1000`,
    ),
    check(
      'webinar_messages_answer_text_check',
      sql`(${t.status} = 'ANSWERED') = (${t.answerText} IS NOT NULL) AND (${t.answerText} IS NULL OR char_length(${t.answerText}) BETWEEN 1 AND 2000)`,
    ),
    check('webinar_messages_host_published_check', sql`${t.kind} <> 'HOST' OR ${t.status} = 'PUBLISHED'`),
    check(
      'webinar_messages_first_name_check',
      sql`${t.kind} = 'HOST' OR ${t.showFirstName} = (${t.authorFirstName} IS NOT NULL)`,
    ),
    tenantIsolation('webinar_messages_tenant_isolation', t.orgId),
  ],
).enableRLS();

/** A poll: open while `opened_at` is set and `closed_at` is null (D-CW-16, WBN-11, WBN-27). */
export const webinarPolls = pgTable(
  'webinar_polls',
  {
    id: idColumn(),
    webinarId: webinarIdColumn(),
    orgId: orgIdColumn(),
    sessionId: text().references(() => callSessions.id, { onDelete: 'restrict' }),
    question: text().notNull(),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    openedAt: ts(),
    closedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('webinar_polls_webinar_id_idx').on(t.webinarId),
    check('webinar_polls_question_length_check', sql`char_length(${t.question}) BETWEEN 1 AND 300`),
    check('webinar_polls_closed_after_open_check', sql`${t.closedAt} IS NULL OR ${t.openedAt} IS NOT NULL`),
    tenantIsolation('webinar_polls_tenant_isolation', t.orgId),
  ],
).enableRLS();

export const webinarPollOptions = pgTable(
  'webinar_poll_options',
  {
    id: idColumn(),
    pollId: text()
      .notNull()
      .references(() => webinarPolls.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
    label: text().notNull(),
    position: integer().notNull(),
  },
  (t) => [
    uniqueIndex('webinar_poll_options_poll_id_position_idx').on(t.pollId, t.position),
    check('webinar_poll_options_label_length_check', sql`char_length(${t.label}) BETWEEN 1 AND 120`),
    check('webinar_poll_options_position_check', sql`${t.position} >= 0`),
    tenantIsolation('webinar_poll_options_tenant_isolation', t.orgId),
  ],
).enableRLS();

/**
 * One row per vote: the poll and the option, nothing about the voter and no
 * timestamp (CW-R-24, WEB-35). Results are counts over these rows.
 */
export const webinarPollResults = pgTable(
  'webinar_poll_results',
  {
    id: idColumn(),
    pollId: text()
      .notNull()
      .references(() => webinarPolls.id, { onDelete: 'restrict' }),
    optionId: text()
      .notNull()
      .references(() => webinarPollOptions.id, { onDelete: 'restrict' }),
    orgId: orgIdColumn(),
  },
  (t) => [
    index('webinar_poll_results_poll_id_option_id_idx').on(t.pollId, t.optionId),
    tenantIsolation('webinar_poll_results_tenant_isolation', t.orgId),
  ],
).enableRLS();

/**
 * The recording pipeline of one webinar session (D-CW-18, CW-R-24b). Written
 * by the recording jobs (T-CW-2.5): SCHEDULED, RECORDING while the capture
 * pipeline runs, PROCESSING from the stop until the concatenation finishes,
 * then READY with `concatenated_key`, or FAILED with `failure_reason` (an
 * error name, never a provider message). S3 layout (T-CW-2.5 step 7):
 * `raw/{webinarId}/` for the capture segments (`raw_segments_prefix`,
 * expired by the bucket's `raw/` lifecycle rule after 30 days) and
 * `final/{webinarId}/` for the concatenated MP4.
 * `handoff_status` stays `pending` with `handoff_location` (the `s3://` URI
 * of the MP4) until the CMS media interface exists (D-CW-03).
 */
export const webinarRecordings = pgTable(
  'webinar_recordings',
  {
    id: idColumn(),
    webinarId: webinarIdColumn(),
    orgId: orgIdColumn(),
    sessionId: text()
      .notNull()
      .references(() => callSessions.id, { onDelete: 'restrict' }),
    status: recordingStatus().notNull().default('SCHEDULED'),
    /** The media capture pipeline. */
    providerPipelineId: text(),
    /** Its ARN, the source of the concatenation pipeline (WEB-29). */
    providerPipelineArn: text(),
    rawSegmentsPrefix: text(),
    /** The media concatenation pipeline the finalize job polls. */
    concatenationPipelineId: text(),
    concatenatedKey: text(),
    handoffStatus: text().notNull().default('pending'),
    /** Where the CMS picks the MP4 up: `s3://{bucket}/{concatenated_key}`. */
    handoffLocation: text(),
    /** Error name of the last failure; never a provider message or personal data. */
    failureReason: text(),
    startedAt: ts(),
    stoppedAt: ts(),
    readyAt: ts(),
    handedOffAt: ts(),
    failedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('webinar_recordings_webinar_id_idx').on(t.webinarId),
    uniqueIndex('webinar_recordings_session_id_idx').on(t.sessionId),
    tenantIsolation('webinar_recordings_tenant_isolation', t.orgId),
  ],
).enableRLS();
