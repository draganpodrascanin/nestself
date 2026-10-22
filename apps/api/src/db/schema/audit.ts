/**
 * Audit and compliance tables [D-21, D-33].
 *
 * `audit_events` is declared here for typed queries. Migration
 * `0001_audit_partitions_rls_roles` converts it to a monthly range-partitioned
 * table and installs the append-only triggers; keep the column list here in
 * sync with that SQL and never let `drizzle-kit generate` alter the table
 * directly (write a custom migration instead).
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { actorKind, auditCategory, auditResult } from './enums.js';
import { users } from './identity.js';
import { organizations } from './organization.js';
import { idColumn, ts } from './_shared.js';

/** Append-only record of a consequential action [D-21, PLAT-04]. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text()
      .notNull()
      .default(sql`gen_random_uuid()::text`),
    /** Event timestamp; partition key for monthly partitions. */
    occurredAt: ts().notNull(),
    /** Null for SYSTEM and some JOB events. */
    actorUserId: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    actorKind: actorKind().notNull(),
    /** Organization context; null for platform-level events. */
    orgId: text().references(() => organizations.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Dotted event name from the audit catalogue. */
    action: text().notNull(),
    /** Affected table or aggregate name, e.g. "grant", "membership". */
    recordType: text().notNull(),
    recordId: text().notNull(),
    result: auditResult().notNull(),
    /** Determines the retention tier [D-21]. */
    category: auditCategory().notNull(),
    /** Safe change details in JSON; never raw tokens or restricted content. */
    details: jsonb().$type<Record<string, unknown>>().notNull(),
    sessionId: text(),
    /** SHA-256 of the client IP; never the raw IP address [D-21]. */
    ipHash: text(),
    /** Parsed user-agent family; never the raw UA string [D-21]. */
    userAgentFamily: text(),
    /** Computed from category and retention policy at insert time. */
    retainUntil: ts().notNull(),
  },
  (t) => [
    /** Composite PK required for range partitioning on occurred_at. */
    primaryKey({ columns: [t.id, t.occurredAt] }),
    index('idx_audit_actor_time').on(t.actorUserId, t.occurredAt),
    index('idx_audit_org_action_time').on(t.orgId, t.action, t.occurredAt),
    index('idx_audit_record').on(t.recordType, t.recordId),
    index('idx_audit_retention').on(t.category, t.retainUntil),
  ],
);

/** Per-domain data retention periods [D-33, L-02, L-03, SYS-10]. */
export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: idColumn(),
    /** e.g. "identity", "membership", "audit_security", "financial_ledger". */
    dataCategory: text().notNull(),
    /** "RS", "HU" or "DEFAULT" [D-33]. */
    jurisdiction: text().notNull().default('DEFAULT'),
    /** Optional service-type qualifier (e.g. "healthcare"). */
    serviceType: text(),
    minDays: integer().notNull(),
    /** Null means no upper bound. */
    maxDays: integer(),
    /** Citation of the applicable law or policy. */
    legalBasis: text().notNull(),
    effectiveFrom: ts().notNull(),
  },
  (t) => [
    uniqueIndex('retention_policies_data_category_jurisdiction_service_type_key').on(
      t.dataCategory,
      t.jurisdiction,
      t.serviceType,
    ),
    /** Unique constraints treat NULLs as distinct; close the gap for a null service type. */
    uniqueIndex('idx_retention_policy_no_service')
      .on(t.dataCategory, t.jurisdiction)
      .where(sql`${t.serviceType} IS NULL`),
  ],
);
