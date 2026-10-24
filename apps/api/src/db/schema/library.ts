/**
 * Employee library tables: saved items, playback states, content preferences
 * and organization content capabilities [C-07, C-11].
 *
 * All four tables are tenant-scoped with `tenantPredicate(t.orgId)`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { contentCapability } from './enums.js';
import { users } from './identity.js';
import { memberships, organizations } from './organization.js';
import { contentResources } from './cms.js';
import { createdAt, idColumn, tenantPredicate, textArray, ts, updatedAt } from './_shared.js';

/**
 * An employee's bookmarked resources, scoped to a membership context.
 * Tenant table [C-07].
 */
export const savedItems = pgTable(
  'saved_items',
  {
    id: idColumn(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    membershipId: text().notNull().references(() => memberships.id, { onDelete: 'cascade' }),
    orgId: text().notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    contentResourceId: text()
      .notNull()
      .references(() => contentResources.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('saved_items_membership_resource_key').on(t.membershipId, t.contentResourceId),
    index('saved_items_membership_created_idx').on(t.membershipId, sql`created_at DESC`, t.id),
    foreignKey({
      columns: [t.membershipId, t.orgId],
      foreignColumns: [memberships.id, memberships.orgId],
      name: 'saved_items_membership_org_fk',
    }),
    pgPolicy('saved_items_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * Resume position for audio and video content. Tenant table [C-07].
 */
export const playbackStates = pgTable(
  'playback_states',
  {
    id: idColumn(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    membershipId: text().notNull().references(() => memberships.id, { onDelete: 'cascade' }),
    orgId: text().notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    contentResourceId: text()
      .notNull()
      .references(() => contentResources.id, { onDelete: 'cascade' }),
    positionSeconds: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('playback_states_membership_resource_key').on(
      t.membershipId,
      t.contentResourceId,
    ),
    foreignKey({
      columns: [t.membershipId, t.orgId],
      foreignColumns: [memberships.id, memberships.orgId],
      name: 'playback_states_membership_org_fk',
    }),
    pgPolicy('playback_states_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * Per-membership content preferences. Tenant table [C-07].
 * No content-locale column; content follows the interface locale [C-28].
 */
export const contentPreferences = pgTable(
  'content_preferences',
  {
    id: idColumn(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    membershipId: text().notNull().references(() => memberships.id, { onDelete: 'cascade' }),
    orgId: text().notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    interestCategoryIds: textArray(),
    continuationHistoryEnabled: boolean().notNull().default(true),
    emailNotificationsEnabled: boolean().notNull().default(true),
    dismissedPollInstanceIds: textArray(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('content_preferences_membership_key').on(t.membershipId),
    check(
      'content_preferences_interest_limit',
      sql`array_length(interest_category_ids, 1) IS NULL OR array_length(interest_category_ids, 1) <= 3`,
    ),
    foreignKey({
      columns: [t.membershipId, t.orgId],
      foreignColumns: [memberships.id, memberships.orgId],
      name: 'content_preferences_membership_org_fk',
    }),
    pgPolicy('content_preferences_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/**
 * Which content capabilities an organization has enabled [C-11].
 * Tenant table.
 */
export const orgContentCapabilities = pgTable(
  'org_content_capabilities',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    capability: contentCapability().notNull(),
    enabledFrom: ts().notNull(),
    enabledUntil: ts(),
    configuredByUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('org_content_capabilities_org_capability_key').on(t.orgId, t.capability),
    pgPolicy('org_content_capabilities_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
