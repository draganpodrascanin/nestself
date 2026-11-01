/**
 * Workplace review tables (ADR 0002, D-EL-03, D-EL-04, D-EL-11, D-EL-12;
 * spec Epics G and H, section 9).
 *
 * `review_services` is platform data: the catalogue NestSelf offers (a
 * quoted review and a free introductory call). Everything else is
 * tenant-scoped under forced row-level security. A request binds the safe
 * snapshot ids it was raised from; a scope is an immutable versioned offer;
 * the engagement is the accepted work with its meeting (an `appointments`
 * row), the sharing grants the employer recorded, the reviewer's report
 * versions (a shared version never changes), internal notes the employer
 * never reads, and the agreed improvement actions.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgPolicy, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import {
  improvementActionStatus,
  reviewEngagementStatus,
  reviewReportStatus,
  reviewRequestStatus,
  reviewScopeStatus,
} from './enums.js';
import { users } from './identity.js';
import type { LocalizedTextJson } from './listening.js';
import { organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, textArray, ts, updatedAt } from './_shared.js';

/** A proposed meeting window, as `FollowUpTimeWindow` of the contracts. */
export interface ReviewWindowJson {
  startsAt: string;
  endsAt: string;
}

/** The catalogue of review services (platform data, spec REV-02, REV-05). */
export const reviewServices = pgTable(
  'review_services',
  {
    id: idColumn(),
    key: text().notNull(),
    name: jsonb().$type<LocalizedTextJson>().notNull(),
    description: jsonb().$type<LocalizedTextJson>().notNull(),
    durationMinutes: integer().notNull(),
    /** Null means the service is quoted per request; 0 is an explicitly free service. */
    priceMinor: integer(),
    currency: text().notNull().default('EUR'),
    introductory: boolean().notNull().default(false),
    termsVersion: text().notNull(),
    termsText: jsonb().$type<LocalizedTextJson>().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('review_services_key_key').on(t.key),
    check('review_services_duration_check', sql`${t.durationMinutes} > 0`),
    check('review_services_price_check', sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`),
  ],
);

/** The statuses in which a request still occupies its scope (one active request per cohort, spec REV-02). */
export const ACTIVE_REQUEST_STATUSES = ['submitted', 'needs_information', 'in_review', 'scoped'] as const;

export const reviewRequests = pgTable(
  'review_requests',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    requesterUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** The published snapshots the request refers to; never raw answers. */
    snapshotIds: textArray(),
    scopeCohortKey: text().notNull().default('company'),
    dimensionKeys: textArray(),
    serviceId: text().references(() => reviewServices.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    context: text(),
    shareAggregates: boolean().notNull().default(false),
    termsVersion: text().notNull(),
    noticeVersion: text().notNull(),
    status: reviewRequestStatus().notNull().default('submitted'),
    coordinatorUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    declineReason: text(),
    informationRequest: text(),
    informationAnswer: text(),
    engagementId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('review_requests_org_id_status_idx').on(t.orgId, t.status),
    index('review_requests_status_created_at_idx').on(t.status, t.createdAt),
    // One active request per reporting scope: the second line behind the service's check.
    uniqueIndex('review_requests_active_scope_key')
      .on(t.orgId, t.scopeCohortKey)
      .where(sql`${t.status} in ('submitted', 'needs_information', 'in_review', 'scoped')`),
    pgPolicy('review_requests_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** An immutable versioned offer (spec REV-05): sent, then accepted, rejected, expired or superseded. */
export const reviewScopes = pgTable(
  'review_scopes',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    requestId: text()
      .notNull()
      .references(() => reviewRequests.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    version: integer().notNull(),
    serviceId: text()
      .notNull()
      .references(() => reviewServices.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    title: text().notNull(),
    deliverables: text().notNull(),
    participants: text().notNull(),
    /** Null means a quote is still open; the request then shows "quote". */
    priceMinor: integer(),
    currency: text().notNull().default('EUR'),
    taxNote: text(),
    termsVersion: text().notNull(),
    validUntil: ts().notNull(),
    cancellationPolicy: text().notNull(),
    status: reviewScopeStatus().notNull().default('draft'),
    sentAt: ts(),
    acceptedAt: ts(),
    acceptedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    rejectedAt: ts(),
    createdByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('review_scopes_request_id_version_key').on(t.requestId, t.version),
    check('review_scopes_price_check', sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`),
    pgPolicy('review_scopes_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** The accepted work (spec REV-05, REV-06, REV-09, REV-10). */
export const reviewEngagements = pgTable(
  'review_engagements',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    requestId: text()
      .notNull()
      .references(() => reviewRequests.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    scopeId: text()
      .notNull()
      .references(() => reviewScopes.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    reviewerUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    coordinatorUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    status: reviewEngagementStatus().notNull().default('accepted'),
    /** The booked meeting (D-EL-12): an appointment with `service_category = 'workplace_review'`. */
    appointmentId: text().references(() => appointments.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    /** The coordinator's one to three proposed windows (D-EL-03), cleared once booked. */
    proposedWindows: jsonb().$type<ReviewWindowJson[]>(),
    proposedTimeZone: text(),
    /** The employer person who booked and attends. */
    participantUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    followUpTargetDate: ts(),
    followUpOwnerUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    followUpAppointmentId: text().references(() => appointments.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    completedAt: ts(),
    canceledAt: ts(),
    cancelReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('review_engagements_request_id_key').on(t.requestId),
    index('review_engagements_org_id_status_idx').on(t.orgId, t.status),
    index('review_engagements_reviewer_user_id_idx').on(t.reviewerUserId),
    check(
      'review_engagements_windows_check',
      sql`case when ${t.proposedWindows} is null then true when jsonb_typeof(${t.proposedWindows}) = 'array' then jsonb_array_length(${t.proposedWindows}) between 1 and 3 else false end`,
    ),
    pgPolicy('review_engagements_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** The employer's recorded decision to share safe snapshots with the reviewer (spec REV-04). */
export const reviewSharingGrants = pgTable(
  'review_sharing_grants',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    engagementId: text()
      .notNull()
      .references(() => reviewEngagements.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshotIds: textArray(),
    cohortKeys: textArray(),
    grantedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    validUntil: ts(),
    revokedAt: ts(),
    revokedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_sharing_grants_engagement_id_idx').on(t.engagementId),
    pgPolicy('review_sharing_grants_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** The reviewer's report (spec REV-07): one draft at a time; a shared version is immutable. */
export const reviewReportVersions = pgTable(
  'review_report_versions',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    engagementId: text()
      .notNull()
      .references(() => reviewEngagements.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    version: integer().notNull(),
    status: reviewReportStatus().notNull().default('draft'),
    /** One rich-text document per section key (`REPORT_SECTION_KEYS`). */
    sections: jsonb().$type<Record<string, unknown>>().notNull(),
    evidenceSnapshotIds: textArray(),
    authorUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    sharedAt: ts(),
    sharedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('review_report_versions_engagement_id_version_key').on(t.engagementId, t.version),
    pgPolicy('review_report_versions_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** The reviewer's internal notes: never part of a report, never read by the employer (spec REV-07). */
export const reviewEngagementNotes = pgTable(
  'review_engagement_notes',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    engagementId: text()
      .notNull()
      .references(() => reviewEngagements.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    authorUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('review_engagement_notes_engagement_id_idx').on(t.engagementId),
    pgPolicy('review_engagement_notes_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** A human-authored action from the report (spec REV-08): proposed, agreed, in progress, completed or not proceeding. */
export const improvementActions = pgTable(
  'improvement_actions',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    engagementId: text()
      .notNull()
      .references(() => reviewEngagements.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    reportVersionId: text().references(() => reviewReportVersions.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    dimensionKey: text(),
    title: text().notNull(),
    description: text().notNull(),
    ownerUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    dueDate: ts(),
    intendedCheck: text().notNull(),
    status: improvementActionStatus().notNull().default('proposed'),
    proposedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    agreedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    agreedAt: ts(),
    completedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    completedAt: ts(),
    notProceedingReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('improvement_actions_engagement_id_idx').on(t.engagementId),
    pgPolicy('improvement_actions_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
