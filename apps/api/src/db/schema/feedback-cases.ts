/**
 * Organizational feedback cases (ADR 0002, D-EL-01 and D-EL-06; spec Epic F
 * and section 9).
 *
 * Restricted access rule (spec 5.1, FBK-02, PRI-03): `feedback_cases` and
 * `feedback_messages` carry no reporter column. The only link between a case
 * and the employee who raised it is `feedback_case_reporters`, read by the
 * reporter's own routes (ownership check) and by the reporter notification,
 * never by a handler, employer, support or operations path. A handler reaches
 * a case only through a CASE assignment on it.
 *
 * Every table is tenant-scoped under forced row-level security.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgPolicy, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { feedbackCaseKind, feedbackCaseState, feedbackMessageSender, feedbackRouteKind } from './enums.js';
import { users } from './identity.js';
import { organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, textArray, ts, updatedAt } from './_shared.js';

/** A staffed route: a primary recipient and an independent alternate (spec FBK-03, FBK-06). */
export const feedbackRoutes = pgTable(
  'feedback_routes',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    kind: feedbackRouteKind().notNull(),
    categories: textArray(),
    primaryHandlerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    alternateHandlerUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    enabled: boolean().notNull().default(false),
    /** When the route is monitored, as the composer shows it (spec FBK-06); never a continuous-response promise. */
    operatingHours: text(),
    responseTargetHours: integer().notNull().default(72),
    /** The organization's actually configured escalation path for the sensitive route. */
    escalationNote: text(),
    updatedByUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('feedback_routes_org_id_kind_key').on(t.orgId, t.kind),
    check('feedback_routes_handlers_check', sql`${t.primaryHandlerUserId} <> ${t.alternateHandlerUserId}`),
    check('feedback_routes_response_target_check', sql`${t.responseTargetHours} > 0`),
    pgPolicy('feedback_routes_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** One case: route, pseudonym, owner, state and targets; deliberately no reporter column. */
export const feedbackCases = pgTable(
  'feedback_cases',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    routeId: text()
      .notNull()
      .references(() => feedbackRoutes.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    kind: feedbackCaseKind().notNull(),
    category: text().notNull(),
    anonymousToEmployer: boolean().notNull().default(true),
    pseudonym: text().notNull(),
    state: feedbackCaseState().notNull().default('submitted'),
    /** `primary` or `alternate`: which recipient of the route holds the case. */
    routeChoice: text().notNull(),
    handlerUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    nextAction: text(),
    dueAt: ts(),
    escalatedAt: ts(),
    resolvedAt: ts(),
    closedAt: ts(),
    outcomeReason: text(),
    /** The last reporter-visible message, either side. */
    lastReporterVisibleAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('feedback_cases_org_id_state_idx').on(t.orgId, t.state),
    index('feedback_cases_handler_user_id_idx').on(t.handlerUserId),
    index('feedback_cases_due_at_idx').on(t.dueAt),
    check('feedback_cases_route_choice_check', sql`${t.routeChoice} in ('primary', 'alternate')`),
    pgPolicy('feedback_cases_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * The reporter of a case: the restricted link (spec 5.1). Read only to
 * authorize the reporter's own routes, to list the reporter's own cases and to
 * address the reporter's neutral notification.
 */
export const feedbackCaseReporters = pgTable(
  'feedback_case_reporters',
  {
    caseId: text()
      .primaryKey()
      .references(() => feedbackCases.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    reporterUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('feedback_case_reporters_reporter_user_id_idx').on(t.reporterUserId),
    pgPolicy('feedback_case_reporters_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** A message in a case: the reporter's (no author), a handler's (visible or internal) or the system's. */
export const feedbackMessages = pgTable(
  'feedback_messages',
  {
    id: idColumn(),
    caseId: text()
      .notNull()
      .references(() => feedbackCases.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    sender: feedbackMessageSender().notNull(),
    /** The handler who wrote it; null for the reporter (no identity on the case) and for system notes. */
    authorUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    body: text().notNull(),
    /** A handler's internal note: never returned to the reporter (spec FBK-02). */
    internal: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('feedback_messages_case_id_created_at_idx').on(t.caseId, t.createdAt),
    check('feedback_messages_reporter_anonymous_check', sql`${t.sender} <> 'reporter' or ${t.authorUserId} is null`),
    check('feedback_messages_internal_check', sql`${t.internal} = false or ${t.sender} = 'handler'`),
    pgPolicy('feedback_messages_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
