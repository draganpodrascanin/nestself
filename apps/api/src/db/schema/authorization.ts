/**
 * Authorization tables: templates, grants, assignments, approval authorities
 * and emergency access [D-15, D-17, D-19, D-20].
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { assignmentKind, emergencyScopeKind } from './enums.js';
import { users } from './identity.js';
import { organizations, orgUnits } from './organization.js';
import { createdAt, idColumn, tenantPredicate, textArray, ts } from './_shared.js';

/**
 * A named starting set of actions, scope type and boundaries from which
 * grants are created [D-17].
 */
export const permissionTemplates = pgTable(
  'permission_templates',
  {
    id: idColumn(),
    /** Human-readable unique key, e.g. "platform_owner", "hr_admin". A UNIQUE
     * constraint (not an index) so that grants.template_key can reference it. */
    key: text().notNull().unique('permission_templates_key_key'),
    name: text().notNull(),
    /** employee, organization, expert, operations. */
    workspace: text().notNull(),
    /** employee, employer_admin, expert, staff, external. */
    population: text().notNull(),
    /** Default action strings from the catalogue (4.3). */
    actions: textArray(),
    /** Default ScopeType value from contracts. */
    scopeType: text().notNull(),
    /** Default conditions (zod-validated at runtime) [D-17]. */
    defaultConditions: jsonb().$type<unknown[]>(),
    requiresSecondFactor: boolean().notNull().default(false),
    /** Actions that require step-up re-authentication [D-14]. */
    stepUpActions: textArray(),
    /** Inactive templates cannot source new grants. */
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  });

/** An explicit, inspectable permission [D-15, D-17]. Tenant-scoped (RLS). */
export const grants = pgTable(
  'grants',
  {
    id: idColumn(),
    subjectUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Template key that sourced this grant; null for ad-hoc grants. */
    templateKey: text().references(() => permissionTemplates.key, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Dotted action strings; no wildcards [D-15]. */
    actions: textArray(),
    scopeType: text().notNull(),
    /** Organization scope; null for platform-wide or own scopes. */
    scopeOrgId: text().references(() => organizations.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Org-unit scope; null when the scope is broader than a unit. */
    scopeOrgUnitId: text().references(() => orgUnits.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Whether the grant covers descendant org units [D-16]. */
    includeDescendants: boolean().notNull().default(false),
    scopeRefKind: text(),
    scopeRefId: text(),
    /** Zod discriminated union: spending_ceiling, categories, confidential_approver, time_window [D-17]. */
    conditions: jsonb().$type<unknown[]>(),
    validFrom: ts().notNull(),
    /** Null means indefinite. */
    validUntil: ts(),
    /** Maximum scope, actions and conditions this grant may delegate [D-17]. */
    delegationEnvelope: jsonb().$type<Record<string, unknown>>(),
    /** Non-null for delegated grants; depth limit 3 [D-17]. */
    parentGrantId: text().references((): AnyPgColumn => grants.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    grantedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    grantedAt: createdAt(),
    /** Non-null means the grant is revoked. */
    revokedAt: ts(),
    revokedByUserId: text().references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    revokedReason: text(),
  },
  (t) => [
    index('grants_subject_user_id_scope_org_id_idx').on(t.subjectUserId, t.scopeOrgId),
    index('grants_scope_org_id_idx').on(t.scopeOrgId),
    index('grants_template_key_idx').on(t.templateKey),
    /** Active grants: not revoked. */
    index('idx_grants_active')
      .on(t.subjectUserId, t.scopeOrgId)
      .where(sql`${t.revokedAt} IS NULL`),
    // Platform-wide and own-scoped grants (scope_org_id IS NULL) stay visible
    // in every tenant context [D-15].
    pgPolicy('grants_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.scopeOrgId, { nullable: true }),
      withCheck: tenantPredicate(t.scopeOrgId, { nullable: true }),
    }),
  ],
).enableRLS();

/** A link between a user and a work item that confers access [D-15, D-19]. */
export const assignments = pgTable(
  'assignments',
  {
    id: idColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    kind: assignmentKind().notNull(),
    /** Polymorphic id of the assigned resource. */
    targetId: text().notNull(),
    assignedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    startAt: ts().notNull(),
    endAt: ts(),
    reason: text(),
  },
  (t) => [
    index('assignments_user_id_kind_idx').on(t.userId, t.kind),
    index('assignments_target_id_kind_idx').on(t.targetId, t.kind),
  ],
);

/**
 * A user's authority to decide requests within scope, categories and an
 * amount ceiling [D-17, MGR-04]. Tenant-scoped (RLS).
 */
export const approvalAuthorities = pgTable(
  'approval_authorities',
  {
    id: idColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    orgUnitId: text().references(() => orgUnits.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    includeDescendants: boolean().notNull().default(false),
    categories: textArray(),
    /** Ceiling in currency minor units; null means no cap. */
    maxAmountMinor: integer(),
    currency: text().default('EUR'),
    validFrom: ts().notNull(),
    validUntil: ts(),
    delegatedFromId: text().references((): AnyPgColumn => approvalAuthorities.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    alternateUserId: text().references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Whether this authority can approve confidential items [D-20]. */
    isConfidentialApprover: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('approval_authorities_org_id_org_unit_id_idx').on(t.orgId, t.orgUnitId),
    pgPolicy('approval_authorities_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * Separately approved, time-limited, logged access to restricted
 * professional content [D-20, PLAT-05].
 */
export const emergencyAccess = pgTable(
  'emergency_access',
  {
    id: idColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** A different platform owner who approved the request [D-20]. */
    approvedByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    purpose: text().notNull(),
    scopeKind: emergencyScopeKind().notNull(),
    scopeId: text().notNull(),
    grantedAt: createdAt(),
    /** At most 4 hours from grantedAt [D-20]. */
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    revokedByUserId: text().references(() => users.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
  },
  (t) => [
    index('emergency_access_user_id_expires_at_idx').on(t.userId, t.expiresAt),
    index('idx_emergency_active').on(t.userId).where(sql`${t.revokedAt} IS NULL`),
  ],
);
