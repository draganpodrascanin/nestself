/**
 * Follow-up approval items (T-CW-1.10, NS-CALLS-01, D-CW-37): when an
 * organization's `follow_up_approval_policy` is `MANAGER_APPROVAL`, a follow-up
 * the employee confirms waits in `AWAITING_APPROVAL` and one row here names the
 * approver chosen from `approval_authorities` and that authority's alternate.
 *
 * The row holds no content: the approver's view is built from the appointment
 * (employee display name, date, duration) and a fixed description, never the
 * service category or the expert's specialty. `reason` is the one free-text
 * field of the flow, a safe rejection reason of at most 300 characters shown to
 * the employee; the controller validates it and it never enters audit details.
 *
 * Tenant-scoped under forced RLS (CW-R-19); the FORCE statement is hand-written
 * in migration 0010.
 *
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md section 7.4
 */
import { sql } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, text } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { appointmentApprovalStatus } from './enums.js';
import { users } from './identity.js';
import { organizations, orgUnits } from './organization.js';
import { createdAt, idColumn, tenantPredicate, ts } from './_shared.js';

export const appointmentApprovals = pgTable(
  'appointment_approvals',
  {
    id: idColumn(),
    appointmentId: text()
      .notNull()
      .references(() => appointments.id, { onDelete: 'restrict' }),
    orgId: text()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    orgUnitId: text().references(() => orgUnits.id, { onDelete: 'set null' }),
    approverUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    alternateUserId: text().references(() => users.id, { onDelete: 'set null' }),
    status: appointmentApprovalStatus().notNull().default('PENDING'),
    /** Safe rejection reason, at most 300 characters, shown to the employee. */
    reason: text(),
    decidedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('appointment_approvals_appointment_id_idx').on(t.appointmentId),
    // The approver's dashboard lists by approver or alternate within an organization.
    index('appointment_approvals_org_id_approver_user_id_idx').on(t.orgId, t.approverUserId),
    index('appointment_approvals_org_id_alternate_user_id_idx').on(t.orgId, t.alternateUserId),
    check('appointment_approvals_reason_length_check', sql`${t.reason} is null or char_length(${t.reason}) <= 300`),
    pgPolicy('appointment_approvals_tenant_isolation', {
      for: 'all',
      using: tenantPredicate(t.orgId),
      withCheck: tenantPredicate(t.orgId),
    }),
  ],
).enableRLS();
