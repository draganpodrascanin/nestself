/**
 * Appointment spine (NS-CALLS-01, D-CW-02, D-CW-37): one consultation between
 * an expert and an employee of a client organization. `org_id` is the
 * employee's organization; the table is tenant-scoped under forced RLS
 * (CW-R-19). `follow_up_of` links a follow-up to the appointment it continues
 * (CW-R-100). Statuses are stored UPPER_CASE and mapped to the contract
 * spellings by the appointments repository (CW-R-19a).
 *
 * Follow-ups (T-CW-1.9): `proposed_at` is when the expert proposed one,
 * `responded_at` when the employee confirmed, suggested other times or
 * declined, and `suggested_windows` the employee's one to three alternative
 * `{ startsAt, endsAt }` windows (ISO instants, times only, no free text,
 * D-CW-04). The service keeps one open follow-up (`proposed` or
 * `awaiting_approval`) per consultation, under a row lock on the finished
 * appointment; there is no unique index because the sample fixtures show
 * both open states on one consultation.
 *
 * The call format is not stored here: it belongs to `call_sessions`.
 *
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md section 5.1
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgPolicy, pgTable, text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { appointmentStatus } from './enums.js';
import { users } from './identity.js';
import { organizations } from './organization.js';
import { createdAt, idColumn, tenantPredicate, ts, updatedAt } from './_shared.js';

/** One suggested window as stored: ISO 8601 instants. */
export interface SuggestedWindow {
  startsAt: string;
  endsAt: string;
}

export const appointments = pgTable(
  'appointments',
  {
    id: idColumn(),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    expertUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    employeeUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startsAt: ts().notNull(),
    endsAt: ts().notNull(),
    status: appointmentStatus().notNull().default('CONFIRMED'),
    serviceCategory: text().notNull(),
    /** IANA name, validated by `TimeZoneSchema` (CALL-29). */
    timeZone: text().notNull().default('Europe/Belgrade'),
    fundingRef: text(),
    followUpOf: text().references((): AnyPgColumn => appointments.id, { onDelete: 'set null' }),
    /** The employee's alternatives for a proposed follow-up (CALL-37). */
    suggestedWindows: jsonb().$type<SuggestedWindow[]>(),
    proposedAt: ts(),
    respondedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The lists filter by organization (operations), employee or expert and sort by start.
    index('appointments_org_id_starts_at_idx').on(t.orgId, t.startsAt),
    index('appointments_employee_user_id_starts_at_idx').on(t.employeeUserId, t.startsAt),
    index('appointments_expert_user_id_starts_at_idx').on(t.expertUserId, t.startsAt),
    index('appointments_follow_up_of_idx').on(t.followUpOf),
    check('appointments_ends_after_starts_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'appointments_suggested_windows_check',
      // CASE, not AND: PostgreSQL does not promise to test the type before taking the length.
      sql`case when ${t.suggestedWindows} is null then true when jsonb_typeof(${t.suggestedWindows}) = 'array' then jsonb_array_length(${t.suggestedWindows}) between 1 and 3 else false end`,
    ),
    pgPolicy('appointments_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
