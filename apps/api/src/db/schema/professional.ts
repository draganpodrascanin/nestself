/**
 * Confidential professional-interaction domain (T-2.4, section 4.7): cases,
 * private conversations between an employee and the expert assigned to their
 * case, and intake records. Every table is tenant-scoped (RLS) and read only
 * by the professional module, which authorizes each row with a confidential
 * resource before returning it [D-20, CONF-R-03].
 *
 * Conversations and intake records reference their case together with their
 * organization, so a row of one organization can never carry the case id of
 * another: the CASE assignment match on the target id alone stays safe.
 */
import { foreignKey, index, pgPolicy, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { organizations } from './organization.js';
import {
  CURRENT_ORG_SETTING,
  createdAt,
  idColumn,
  tenantPredicate,
  tenantPredicateVia,
} from './_shared.js';

/**
 * A case of one organization: the target of CASE assignments
 * (`assignments.target_id`). `(id, org_id)` is unique so that conversations
 * and intake records reference it together with their own organization.
 */
export const cases = pgTable(
  'cases',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('cases_id_org_id_key').on(t.id, t.orgId),
    pgPolicy('cases_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();

export const conversations = pgTable(
  'conversations',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** A case of the same organization (`conversations_case_org_fk`). */
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
    foreignKey({
      columns: [t.caseId, t.orgId],
      foreignColumns: [cases.id, cases.orgId],
      name: 'conversations_case_org_fk',
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
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
    /** A case of the same organization (`intake_records_case_org_fk`). */
    caseId: text().notNull(),
    employeeUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('intake_records_case_id_idx').on(t.caseId),
    foreignKey({
      columns: [t.caseId, t.orgId],
      foreignColumns: [cases.id, cases.orgId],
      name: 'intake_records_case_org_fk',
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    pgPolicy('intake_records_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
