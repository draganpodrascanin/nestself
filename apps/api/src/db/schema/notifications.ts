/**
 * Outbox and notification tables [C-23].
 *
 * `outbox_events` is platform data (no RLS) even though it carries an
 * optional `org_id` for tenant-scoped events [section 4, C-07].
 * `outbox_deliveries` is a per-consumer delivery record; no RLS.
 * `notifications` is tenant-scoped (RLS).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { notificationKind, outboxDeliveryState } from './enums.js';
import { users } from './identity.js';
import { organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, ts } from './_shared.js';

/**
 * Transactional outbox for all domain events [C-23]. Platform data, no RLS.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: idColumn(),
    type: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    orgId: text(),
    payload: jsonb().notNull(),
    createdAt: createdAt(),
    publishedAt: ts(),
    attempts: integer().notNull().default(0),
    lastErrorCode: text(),
  },
  (t) => [
    index('outbox_events_dispatch_idx')
      .on(t.createdAt, t.id)
      .where(sql`published_at IS NULL`),
    index('outbox_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
    check(
      'outbox_events_payload_object_check',
      sql`jsonb_typeof(payload) = 'object'`,
    ),
  ],
);

/**
 * Per-consumer delivery record for outbox events [C-23]. No RLS.
 */
export const outboxDeliveries = pgTable(
  'outbox_deliveries',
  {
    id: idColumn(),
    outboxEventId: text()
      .notNull()
      .references(() => outboxEvents.id, { onDelete: 'cascade' }),
    consumer: text().notNull(),
    state: outboxDeliveryState().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    lastErrorCode: text(),
    nextAttemptAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('outbox_deliveries_event_consumer_key').on(t.outboxEventId, t.consumer),
    index('outbox_deliveries_state_next_attempt_idx')
      .on(t.state, t.nextAttemptAt)
      .where(sql`state IN ('pending', 'failed')`),
  ],
);

/**
 * In-app notifications per user and organization [C-23]. Tenant table.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: idColumn(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    kind: notificationKind().notNull(),
    targetType: text().notNull(),
    targetId: text().notNull(),
    params: jsonb(),
    readAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_org_created_idx').on(t.userId, t.orgId, sql`created_at DESC`),
    pgPolicy('notifications_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
