/**
 * The follow-up approval seam (D-CW-37, guidelines 7.4, T-CW-1.9).
 *
 * When the organization's policy is `manager_approval`, confirming a
 * follow-up (the employee's confirm, or the expert's pick of a suggested
 * window) moves the appointment to `awaiting_approval` and calls
 * {@link FollowUpApprovalRequester.request} inside the same transaction. The
 * requester routes the approval item to an approver; when it throws, the
 * transaction rolls back and the appointment stays `proposed`.
 *
 * T-CW-1.10 binds the approval service (approver selection of guidelines
 * 7.4, the `appointment_approvals` row, `appointment.approval.requested`,
 * the approver's email) to {@link FOLLOW_UP_APPROVAL}. Until then
 * {@link NotConfiguredFollowUpApproval} is bound: no approver can be found, so
 * the confirmation fails visibly with 409 `approver_missing` and
 * `appointment.approval.missing_approver` is audited (CW-R-118). The audit is
 * written outside the transaction, so it survives the rollback.
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
import type { DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import type { AppointmentRecord } from './appointments.repository.js';

/** Nest token of the {@link FollowUpApprovalRequester} binding. */
export const FOLLOW_UP_APPROVAL = Symbol('FOLLOW_UP_APPROVAL');

export interface FollowUpApprovalRequester {
  /**
   * Route `appointment` (already `awaiting_approval` in `tx`) to its
   * approver. `actorUserId` is who confirmed: the employee, or the expert who
   * picked a suggested window. Throws to refuse the confirmation; 409
   * `approver_missing` when no approval authority covers the employee's unit.
   */
  request(appointment: AppointmentRecord, tx: DbExecutor, actorUserId: string): Promise<void>;
}

/** 409 `approver_missing`: the policy needs an approver and none covers the employee (CALL-41 criterion 4). */
export function approverMissing(): ApiHttpException {
  return new ApiHttpException({
    status: 409,
    code: 'approver_missing',
    message: 'No approver covers this employee; ask HR to name one',
  });
}

/** The binding until T-CW-1.10: there is never an approver. */
@Injectable()
export class NotConfiguredFollowUpApproval implements FollowUpApprovalRequester {
  constructor(
    private readonly audit: AuditWriter,
    private readonly memberships: MembershipsRepository,
  ) {}

  async request(appointment: AppointmentRecord, tx: DbExecutor, actorUserId: string): Promise<void> {
    const membership = await this.memberships.findActiveByUserAndOrg(appointment.employeeUserId, appointment.orgId, tx);
    await this.audit.record({
      action: 'appointment.approval.missing_approver',
      actorUserId,
      actorKind: 'USER',
      orgId: appointment.orgId,
      recordType: 'appointment',
      recordId: appointment.id,
      result: 'DENIED',
      details: { appointmentId: appointment.id, orgId: appointment.orgId, orgUnitId: membership?.orgUnitId ?? null },
    });
    throw approverMissing();
  }
}
