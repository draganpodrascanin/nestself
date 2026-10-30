/**
 * FollowUpService unit tests (T-CW-1.9, T-CW-1.10 seam): under
 * `manager_approval` the requester's `afterCommit` hook runs once, after the
 * move to `awaiting_approval` committed, for the employee's confirm and the
 * expert's pick of a window; its failure is logged and the status stays. An
 * expired proposal cannot be confirmed; a missing approver is audited after
 * the rollback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { AppointmentRecord } from './appointments.repository.js';
import { approverMissing } from './follow-up-approval.js';
import { FollowUpService } from './follow-up.service.js';

const HOUR = 3_600_000;
const EMPLOYEE = { userId: 'user_jovan' } as Principal;
const EXPERT = { userId: 'user_milica' } as Principal;

function followUp(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  const startsAt = new Date(Date.now() + 48 * HOUR);
  return {
    id: 'appt_next',
    orgId: 'org_sample',
    expertUserId: EXPERT.userId,
    employeeUserId: EMPLOYEE.userId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + HOUR),
    status: 'proposed',
    serviceCategory: 'psychological',
    timeZone: 'Europe/Belgrade',
    fundingRef: null,
    followUpOf: 'appt_done',
    suggestedWindows: null,
    proposedAt: new Date(),
    respondedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(current: AppointmentRecord, policy: 'automatic' | 'manager_approval' = 'manager_approval') {
  const repo = {
    findById: vi.fn().mockResolvedValue(current),
    updateFromStatus: vi.fn(async (_id: string, _from: string, to: AppointmentRecord['status'], changes: Partial<AppointmentRecord>) => ({
      ...current,
      ...changes,
      status: to,
    })),
    toResponse: vi.fn(async (record: AppointmentRecord) => ({ id: record.id, status: record.status })),
  };
  const tx = { tx: true };
  const dbs = { withOrgScope: vi.fn(async (_orgId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const callsJobs = { scheduleReminders: vi.fn().mockResolvedValue(0), cancelAppointmentJobs: vi.fn().mockResolvedValue(undefined) };
  const policies = { policyOf: vi.fn().mockResolvedValue(policy) };
  const approvals = { request: vi.fn().mockResolvedValue(undefined), afterCommit: vi.fn().mockResolvedValue(undefined) };
  const notifier = { confirmed: vi.fn().mockResolvedValue(undefined) };
  const memberships = { findActiveByUserAndOrg: vi.fn().mockResolvedValue({ orgUnitId: 'ou_dev' }) };
  const service = new FollowUpService(
    repo as never,
    dbs as never,
    { invalidateUser: vi.fn() } as never,
    audit as never,
    callsJobs as never,
    policies as never,
    approvals as never,
    {} as never,
    notifier as never,
    memberships as never,
  );
  return { service, repo, tx, audit, approvals, notifier, callsJobs };
}

describe('FollowUpService and the approval seam', () => {
  afterEach(() => vi.restoreAllMocks());

  it('confirm under manager_approval: request in the transaction, then afterCommit once with the moved record', async () => {
    const { service, approvals, tx } = setup(followUp());
    const response = await service.confirm('appt_next', EMPLOYEE);
    expect(response).toEqual({ id: 'appt_next', status: 'awaiting_approval' });
    expect(approvals.request).toHaveBeenCalledWith(expect.objectContaining({ id: 'appt_next', status: 'awaiting_approval' }), tx, EMPLOYEE.userId);
    expect(approvals.afterCommit).toHaveBeenCalledTimes(1);
    expect(approvals.afterCommit).toHaveBeenCalledWith(expect.objectContaining({ id: 'appt_next', status: 'awaiting_approval' }), EMPLOYEE.userId);
    expect(approvals.request.mock.invocationCallOrder[0]!).toBeLessThan(approvals.afterCommit.mock.invocationCallOrder[0]!);
  });

  it('schedule under manager_approval calls afterCommit once with the moved record at the picked window', async () => {
    const window = { startsAt: new Date(Date.now() + 72 * HOUR).toISOString(), endsAt: new Date(Date.now() + 75 * HOUR).toISOString() };
    const { service, approvals } = setup(followUp({ suggestedWindows: [window] }));
    await service.schedule('appt_next', { selectedWindowIndex: 0 }, EXPERT);
    expect(approvals.afterCommit).toHaveBeenCalledTimes(1);
    expect(approvals.afterCommit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'awaiting_approval', startsAt: new Date(window.startsAt) }),
      EXPERT.userId,
    );
  });

  it('logs a failing afterCommit and keeps the status change', async () => {
    const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, approvals } = setup(followUp());
    approvals.afterCommit.mockRejectedValueOnce(new Error('mail down'));
    await expect(service.confirm('appt_next', EMPLOYEE)).resolves.toEqual({ id: 'appt_next', status: 'awaiting_approval' });
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appt_next', operation: 'approvalAfterCommit' }), expect.any(String));
  });

  it('does not call afterCommit under the automatic policy, nor when the requester refuses', async () => {
    const automatic = setup(followUp(), 'automatic');
    await automatic.service.confirm('appt_next', EMPLOYEE);
    expect(automatic.approvals.afterCommit).not.toHaveBeenCalled();

    const refused = setup(followUp());
    refused.approvals.request.mockRejectedValueOnce(approverMissing());
    await expect(refused.service.confirm('appt_next', EMPLOYEE)).rejects.toMatchObject({ code: 'approver_missing' });
    expect(refused.approvals.afterCommit).not.toHaveBeenCalled();
    // The missing approver is audited after the rollback, with the employee's unit.
    expect(refused.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'appointment.approval.missing_approver',
        details: { appointmentId: 'appt_next', orgId: 'org_sample', orgUnitId: 'ou_dev' },
      }),
    );
  });

  it('refuses to confirm a proposal whose start has passed (409 follow_up_not_allowed)', async () => {
    const { service, repo } = setup(followUp({ startsAt: new Date(Date.now() - HOUR), endsAt: new Date() }));
    const error = await service.confirm('appt_next', EMPLOYEE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpException);
    expect(error).toMatchObject({ code: 'follow_up_not_allowed' });
    expect(repo.updateFromStatus).not.toHaveBeenCalled();
  });
});
