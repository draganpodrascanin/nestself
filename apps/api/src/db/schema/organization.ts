/**
 * Organization tables: employers, the org-unit tree with its closure table,
 * memberships and the legacy teams table with its compatibility view
 * [D-03, D-16, D-36].
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  pgView,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { membershipStatus, orgUnitKind } from './enums.js';
import { users } from './identity.js';
import {
  CURRENT_ORG_SETTING,
  createdAt,
  idColumn,
  tenantPredicate,
  tenantPredicateVia,
  ts,
  updatedAt,
} from './_shared.js';

/** An employer client company [D-02, PLAT-01]. */
export const organizations = pgTable(
  'organizations',
  {
    id: idColumn(),
    name: text().notNull(),
    slug: text().notNull(),
    /** ISO 3166-1 alpha-2: "RS" or "HU" [D-33]. */
    country: text().notNull().default('RS'),
    /** IANA timezone identifier [PLAT-01]. */
    timezone: text().notNull().default('Europe/Belgrade'),
    contractStart: ts(),
    contractEnd: ts(),
    /** Initial owner assigned at creation [PLAT-01]. */
    ownerUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    /** authorize() denies self-approval when false [D-17]. */
    selfApprovalAllowed: boolean().notNull().default(false),
    /** Minor units above which financial step-up applies [D-14]. */
    financialStepUpThresholdMinor: integer(),
    /** Per-organization reporting cohort threshold; null falls back to the platform default (F-03). */
    cohortThreshold: integer(),
    /** Lifecycle state: ONBOARDING, ACTIVE, SUSPENDED, ENDED. */
    status: text().notNull().default('ACTIVE'),
    /**
     * What an employee's confirmation of a follow-up does (D-CW-37):
     * `AUTOMATIC` confirms it, `MANAGER_APPROVAL` routes it to an approver.
     * Stored UPPER_CASE; the appointments module maps it to the contract's
     * lower-case `FollowUpApprovalPolicy` (`follow-up-policy.ts`).
     */
    followUpApprovalPolicy: text().notNull().default('AUTOMATIC'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organizations_slug_key').on(t.slug),
    check(
      'organizations_follow_up_approval_policy_check',
      sql`${t.followUpApprovalPolicy} in ('AUTOMATIC', 'MANAGER_APPROVAL')`,
    ),
  ],
);

/**
 * A node in an organization's tree: company root, department or team.
 * Replaces the flat Team model [D-16]. Tenant-scoped (RLS).
 */
export const orgUnits = pgTable(
  'org_units',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Null for the company-root node. */
    parentId: text().references((): AnyPgColumn => orgUnits.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    kind: orgUnitKind().notNull().default('DEPARTMENT'),
    name: text().notNull(),
    costCenterCode: text(),
    /** Non-null hides the unit from active queries. */
    archivedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('org_units_org_id_kind_idx').on(t.orgId, t.kind),
    pgPolicy('org_units_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

const ORG_UNIT_CLOSURE_TENANT_EXISTS = `select 1 from "org_units" where "org_units"."id" = "org_unit_closure"."ancestor_id" and "org_units"."org_id" = ${CURRENT_ORG_SETTING}`;

/**
 * Closure table for ancestor and descendant queries on org units [D-16].
 * Every node has a self-referencing entry at depth 0 (AUTHZ-R-09).
 */
export const orgUnitClosure = pgTable(
  'org_unit_closure',
  {
    ancestorId: text()
      .notNull()
      .references(() => orgUnits.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    descendantId: text()
      .notNull()
      .references(() => orgUnits.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** 0 = self, 1 = direct parent, 2 = grandparent, and so on. */
    depth: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ancestorId, t.descendantId] }),
    index('org_unit_closure_descendant_id_idx').on(t.descendantId),
    // Both ends of a closure row belong to the same organization; correlating
    // on the ancestor is enough [D-19, D-37].
    pgPolicy('org_unit_closure_tenant_isolation', {
      for: 'all',
      using: tenantPredicateVia(ORG_UNIT_CLOSURE_TENANT_EXISTS),
      withCheck: tenantPredicateVia(ORG_UNIT_CLOSURE_TENANT_EXISTS),
    }),
  ],
).enableRLS();

/**
 * A user's eligibility in an organization with effective dates
 * [D-03, ORG-02, ORG-04, F10]. Tenant-scoped (RLS).
 */
export const memberships = pgTable(
  'memberships',
  {
    id: idColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Primary team or department. */
    orgUnitId: text().references(() => orgUnits.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    /** Cost-center org unit for charging (may differ from orgUnitId). */
    costCenterUnitId: text().references(() => orgUnits.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    lineManagerUserId: text().references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    status: membershipStatus().notNull().default('INVITED'),
    /** Effective start; set at activation [ORG-02]. */
    startDate: ts().notNull(),
    /** Effective end; set on deactivation [ORG-04]. */
    endDate: ts(),
    /** LEFT, CONTRACT_ENDED, DEACTIVATED_BY_HR, SUSPENDED_BY_PLATFORM, MERGED. */
    endedReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** @deprecated Replaced by orgUnitId; removed in phase 2 [D-36]. */
    teamId: text().references(() => legacyTeams.id, { onDelete: 'set null', onUpdate: 'cascade' }),
  },
  (t) => [
    uniqueIndex('memberships_user_id_org_id_start_date_key').on(t.userId, t.orgId, t.startDate),
    index('memberships_org_id_status_idx').on(t.orgId, t.status),
    /** One active membership per user per organization. */
    uniqueIndex('idx_memberships_one_active')
      .on(t.userId, t.orgId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('idx_memberships_active_org').on(t.orgId).where(sql`${t.status} = 'ACTIVE'`),
    pgPolicy('memberships_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * @deprecated Replaced by org units [D-16, D-36]. Retained during phase 0-1
 * for Channel, Poll and Membership.teamId references. The SQL table is named
 * `legacy_teams` so that the `teams` view can expose team org units.
 */
export const legacyTeams = pgTable('legacy_teams', {
  id: idColumn(),
  name: text().notNull(),
  orgId: text()
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
});

/**
 * Compatibility view: one row per TEAM org unit (id, name, org_id).
 * Declared with explicit columns and raw SQL because drizzle-kit does not apply
 * `casing` inside query-builder views.
 */
export const teams = pgView('teams', {
  id: text('id'),
  name: text('name'),
  orgId: text('org_id'),
}).as(sql`select "id", "name", "org_id" from "org_units" where "kind" = 'TEAM'`);
