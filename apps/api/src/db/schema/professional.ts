/**
 * Confidential professional-interaction domain (T-2.4, section 4.7): private
 * conversations between an employee and the expert assigned to their case,
 * and intake records. Every table is tenant-scoped (RLS) and read only by
 * the professional module, which authorizes each row with a confidential
 * resource before returning it [D-20, CONF-R-03].
 *
 * There is no `cases` table yet: `case_id` is the identifier that CASE
 * assignments target.
 */
import { index, pgPolicy, pgTable, text } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { organizations } from './organization.js';
import {
  CURRENT_ORG_SETTING,
  createdAt,
  idColumn,
  tenantPredicate,
  tenantPredicateVia,
} from './_shared.js';

export const conversations = pgTable(
  'conversations',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    // TODO(phase-2-readiness): case_id is unconstrained and CASE assignments
    // match on targetId only. Blocker for any write path: add a
    // cases(id, org_id) table and FK this column to it.
    caseId: text().notNull(),
    employeeUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    expertUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('conversations_case_id_idx').on(t.caseId),
    pgPolicy('conversations_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

/** Messages reach their organization through `conversations`. */
const CONVERSATION_MESSAGES_TENANT_EXISTS = `select 1 from "conversations" where "conversations"."id" = "conversation_messages"."conversation_id" and "conversations"."org_id" = ${CURRENT_ORG_SETTING}`;

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: idColumn(),
    conversationId: text()
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    authorUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('conversation_messages_conversation_id_created_at_idx').on(t.conversationId, t.createdAt),
    pgPolicy('conversation_messages_tenant_isolation', {
      for: 'all',
      using: tenantPredicateVia(CONVERSATION_MESSAGES_TENANT_EXISTS),
      withCheck: tenantPredicateVia(CONVERSATION_MESSAGES_TENANT_EXISTS),
    }),
  ],
).enableRLS();

export const intakeRecords = pgTable(
  'intake_records',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    // TODO(phase-2-readiness): case_id is unconstrained and CASE assignments
    // match on targetId only. Blocker for any write path: add a
    // cases(id, org_id) table and FK this column to it.
    caseId: text().notNull(),
    employeeUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('intake_records_case_id_idx').on(t.caseId),
    pgPolicy('intake_records_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
