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
 * T-CW-1.10 binds `ApprovalService` (`approval.service.ts`) to
 * {@link FOLLOW_UP_APPROVAL}: the approver selection of guidelines 7.4 and the
 * `appointment_approvals` row in the transaction, then
 * `appointment.approval.requested`, the approver's email and the jobs in
 * {@link FollowUpApprovalRequester.afterCommit}.
 *
 * Contract for every binding: throw
 * {@link approverMissing} when no authority covers the employee, and do not
 * audit `appointment.approval.missing_approver` yourself. `FollowUpService`
 * writes that event after the transaction has rolled back, so the audit
 * never takes a second pool connection while the confirming transaction
 * holds one, and is never lost with the rollback.
 */
import { Injectable } from '@nestjs/common';
import { ApiHttpException } from '../common/api-error.js';
import type { DbExecutor } from '../db/db.service.js';
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

  /**
   * Called by `FollowUpService` once the confirming transaction has
   * committed, for the work that must not hold the transaction's connection:
   * the `appointment.approval.requested` audit event, the approver's email and
   * the reminder and expiry jobs (T-CW-1.10). Best effort.
   */
  afterCommit?(appointment: AppointmentRecord, actorUserId: string): Promise<void>;
}

/** 409 `approver_missing`: the policy needs an approver and none covers the employee (CALL-41 criterion 4). */
export function approverMissing(): ApiHttpException {
  return new ApiHttpException({
    status: 409,
    code: 'approver_missing',
    message: 'No approver covers this employee; ask HR to name one',
  });
}

/**
 * A binding with no approver: every confirmation under `manager_approval` is
 * refused with 409 `approver_missing`. No longer bound by `AppointmentsModule`
 * (T-CW-1.10 binds `ApprovalService`); kept for tests that wire the follow-up
 * service alone.
 */
@Injectable()
export class NotConfiguredFollowUpApproval implements FollowUpApprovalRequester {
  request(_appointment: AppointmentRecord, _tx: DbExecutor, _actorUserId: string): Promise<void> {
    return Promise.reject(approverMissing());
  }
}
