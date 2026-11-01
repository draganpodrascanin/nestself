/**
 * Employee listening tables (ADR 0002, D-EL-01; spec section 9).
 *
 * Restricted access rule (spec 5.1, PRI-03): `survey_participations` is the
 * technical link between a member and a cycle (eligibility, duplicate
 * prevention, reminders, the employee's own draft and receipt) and
 * `survey_responses` holds the answers with no user or membership column.
 * The only link between the two is `survey_participations.response_id`, read
 * by the submission path and the purge job. No employer, reviewer, support or
 * operations route selects from either table, lists participations or joins
 * them to users; employer reporting reads `survey_snapshots` and
 * `survey_aggregate_cells` only, through the disclosure mapper.
 *
 * `questionnaire_versions` is platform data (NestSelf owns the instrument);
 * every other table is tenant-scoped under forced row-level security.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { questionnaireStatus, surveyCycleStatus, surveyParticipationState } from './enums.js';
import { users } from './identity.js';
import { memberships, organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, ts, updatedAt } from './_shared.js';

/** One wording per interface locale, as `LocalizedText` of the contracts. */
export type LocalizedTextJson = Record<'en' | 'sr-Latn' | 'sr-Cyrl' | 'hu', string>;

/** A questionnaire dimension as stored (`QuestionnaireDimension` of the contracts). */
export interface QuestionnaireDimensionJson {
  key: string;
  question: LocalizedTextJson;
  scaleLow: LocalizedTextJson;
  scaleHigh: LocalizedTextJson;
  explanation: LocalizedTextJson;
}

/** Answers by dimension key, 1..5; a skipped dimension is absent. */
export type SurveyAnswersJson = Record<string, number>;

/** Versioned instrument: five positively keyed questions and the privacy notice (spec SUR-01, CFG-03). */
export const questionnaireVersions = pgTable(
  'questionnaire_versions',
  {
    id: idColumn(),
    version: integer().notNull(),
    status: questionnaireStatus().notNull().default('draft'),
    dimensions: jsonb().$type<QuestionnaireDimensionJson[]>().notNull(),
    notice: jsonb().$type<LocalizedTextJson>().notNull(),
    /** The version whose results stay comparable with this one (same meaning and scale). */
    comparableWithVersionId: text().references((): AnyPgColumn => questionnaireVersions.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    publishedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    publishedAt: ts(),
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('questionnaire_versions_version_key').on(t.version)],
);

/**
 * Per-client entitlements and pilot rules (spec CFG-01, CFG-03). Changing a
 * rule bumps `policy_version` and writes a `listening_policy_versions` row;
 * a cycle locks the row it was launched under.
 */
export const listeningConfigurations = pgTable(
  'listening_configurations',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    measurementFrom: ts(),
    measurementUntil: ts(),
    feedbackFrom: ts(),
    feedbackUntil: ts(),
    workplaceReviewsFrom: ts(),
    workplaceReviewsUntil: ts(),
    /** The sensitive feedback route may be enabled by the organization (spec FBK-06, D-EL-10). */
    feedbackSensitiveEnabled: boolean().notNull().default(false),
    cadenceDays: integer().notNull().default(14),
    responseWindowDays: integer().notNull().default(7),
    reminderLimit: integer().notNull().default(2),
    freshnessDays: integer().notNull().default(45),
    /** Distinct valid respondents per dimension per cohort; never below the platform floor. */
    minimumCohort: integer().notNull().default(10),
    goodThresholdTenths: integer().notNull().default(750),
    monitorThresholdTenths: integer().notNull().default(600),
    algorithmVersion: integer().notNull().default(1),
    questionnaireVersionId: text().references(() => questionnaireVersions.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** The next automatic launch; null means no recurring launches are scheduled. */
    nextLaunchAt: ts(),
    policyVersion: integer().notNull().default(1),
    updatedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('listening_configurations_org_id_key').on(t.orgId),
    check('listening_configurations_minimum_cohort_check', sql`${t.minimumCohort} >= 10`),
    check(
      'listening_configurations_thresholds_check',
      sql`${t.monitorThresholdTenths} < ${t.goodThresholdTenths}`,
    ),
    check('listening_configurations_reminder_limit_check', sql`${t.reminderLimit} between 0 and 2`),
    pgPolicy('listening_configurations_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** The rules in force at a point in time; a cycle references the version it was launched under. */
export const listeningPolicyVersions = pgTable(
  'listening_policy_versions',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    policyVersion: integer().notNull(),
    cadenceDays: integer().notNull(),
    responseWindowDays: integer().notNull(),
    reminderLimit: integer().notNull(),
    freshnessDays: integer().notNull(),
    minimumCohort: integer().notNull(),
    goodThresholdTenths: integer().notNull(),
    monitorThresholdTenths: integer().notNull(),
    algorithmVersion: integer().notNull(),
    questionnaireVersionId: text().references(() => questionnaireVersions.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    effectiveFrom: ts().notNull(),
    createdByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('listening_policy_versions_org_id_policy_version_key').on(t.orgId, t.policyVersion),
    pgPolicy('listening_policy_versions_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** One scheduled occurrence of the survey (spec SUR-02..04, section 8). */
export const surveyCycles = pgTable(
  'survey_cycles',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    questionnaireVersionId: text()
      .notNull()
      .references(() => questionnaireVersions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    policyVersionId: text()
      .notNull()
      .references(() => listeningPolicyVersions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    opensAt: ts().notNull(),
    closesAt: ts().notNull(),
    status: surveyCycleStatus().notNull().default('scheduled'),
    /** Size of the launch snapshot; never a list of people. */
    audienceSize: integer(),
    launchedAt: ts(),
    finalizedAt: ts(),
    canceledAt: ts(),
    /** The error name of a failed finalization, for the operations queue; never content. */
    failureReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('survey_cycles_org_id_opens_at_key').on(t.orgId, t.opensAt),
    index('survey_cycles_status_closes_at_idx').on(t.status, t.closesAt),
    check('survey_cycles_window_check', sql`${t.closesAt} > ${t.opensAt}`),
    pgPolicy('survey_cycles_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * The restricted technical link between a member and a cycle (spec 5.1,
 * PRI-03): eligibility at launch, the primary department of the launch
 * snapshot, the private state, duplicate prevention and reminders. Read only
 * by the participation service, the reminder job and the purge job.
 */
export const surveyParticipations = pgTable(
  'survey_participations',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    cycleId: text()
      .notNull()
      .references(() => surveyCycles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    membershipId: text()
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** The primary department at launch; null means the `unassigned` cohort. */
    cohortUnitId: text(),
    state: surveyParticipationState().notNull().default('invited'),
    /** The accepted response; the only link from a person to an answer row. */
    responseId: text(),
    remindersSent: integer().notNull().default(0),
    lastReminderAt: ts(),
    submittedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('survey_participations_cycle_id_membership_id_key').on(t.cycleId, t.membershipId),
    uniqueIndex('survey_participations_cycle_id_user_id_key').on(t.cycleId, t.userId),
    uniqueIndex('survey_participations_response_id_key').on(t.responseId),
    index('survey_participations_cycle_id_state_idx').on(t.cycleId, t.state),
    pgPolicy('survey_participations_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** The employee's private draft; deleted on submission, purged after the cycle (spec EMP-02). */
export const surveyDrafts = pgTable(
  'survey_drafts',
  {
    participationId: text()
      .primaryKey()
      .references(() => surveyParticipations.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    answers: jsonb().$type<SurveyAnswersJson>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    pgPolicy('survey_drafts_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * An accepted submission: the answers, the cycle, the questionnaire version
 * and the launch-snapshot cohort. Deliberately no user or membership column.
 */
export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    cycleId: text()
      .notNull()
      .references(() => surveyCycles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    questionnaireVersionId: text()
      .notNull()
      .references(() => questionnaireVersions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** The primary department of the launch snapshot; null means `unassigned`. */
    cohortUnitId: text(),
    answers: jsonb().$type<SurveyAnswersJson>().notNull(),
    /** The server's acceptance instant, taken under the cycle's acceptance lock. */
    acceptedAt: ts().notNull(),
  },
  (t) => [
    index('survey_responses_cycle_id_idx').on(t.cycleId),
    pgPolicy('survey_responses_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** The one immutable reporting release of a finalized cycle (spec SUR-04). */
export const surveySnapshots = pgTable(
  'survey_snapshots',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    cycleId: text()
      .notNull()
      .references(() => surveyCycles.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    algorithmVersion: integer().notNull(),
    policyVersionId: text()
      .notNull()
      .references(() => listeningPolicyVersions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    questionnaireVersionId: text()
      .notNull()
      .references(() => questionnaireVersions.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    audienceSize: integer().notNull(),
    submittedCount: integer().notNull(),
    publishedAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('survey_snapshots_cycle_id_key').on(t.cycleId),
    index('survey_snapshots_org_id_published_at_idx').on(t.orgId, t.publishedAt),
    pgPolicy('survey_snapshots_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * One dimension of one cohort in a snapshot: the protected counts, the official
 * score and the canonical disclosure decision (spec 4.3, 5.2). Only the
 * disclosure mapper turns a row into a public cell.
 */
export const surveyAggregateCells = pgTable(
  'survey_aggregate_cells',
  {
    id: idColumn(),
    snapshotId: text()
      .notNull()
      .references(() => surveySnapshots.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** `company`, an org-unit id, or `unassigned`. */
    cohortKey: text().notNull(),
    cohortUnitId: text(),
    dimensionKey: text().notNull(),
    validCount: integer().notNull(),
    favorableCount: integer().notNull(),
    neutralCount: integer().notNull(),
    unfavorableCount: integer().notNull(),
    /** Null when nothing valid was answered. */
    scoreTenths: integer(),
    /** `good`, `monitor`, `danger`, or null when there is no score. */
    status: text(),
    /** `primary` or `secondary` when the cell is withheld; null when shown. */
    suppression: text(),
  },
  (t) => [
    uniqueIndex('survey_aggregate_cells_snapshot_cohort_dimension_key').on(t.snapshotId, t.cohortKey, t.dimensionKey),
    check('survey_aggregate_cells_status_check', sql`${t.status} is null or ${t.status} in ('good','monitor','danger')`),
    check(
      'survey_aggregate_cells_suppression_check',
      sql`${t.suppression} is null or ${t.suppression} in ('primary','secondary')`,
    ),
    pgPolicy('survey_aggregate_cells_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** A viewer dismissed the review offer of one snapshot (spec REV-01); the red card stays. */
export const surveyOfferDismissals = pgTable(
  'survey_offer_dismissals',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    snapshotId: text()
      .notNull()
      .references(() => surveySnapshots.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    dismissedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('survey_offer_dismissals_snapshot_id_user_id_key').on(t.snapshotId, t.userId),
    pgPolicy('survey_offer_dismissals_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
