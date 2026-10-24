/**
 * The follow-up approval seam (D-CW-37, T-CW-1.9): until T-CW-1.10 binds the
 * approval service, a confirmation under `manager_approval` fails visibly with
 * 409 `approver_missing` and audits `appointment.approval.missing_approver`.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiHttpException } from '../common/api-error.js';
import { NotConfiguredFollowUpApproval } from './follow-up-approval.js';
import type { AppointmentRecord } from './appointments.repository.js';

const FOLLOW_UP: AppointmentRecord = {
  id: 'appt_next',
  orgId: 'org_sample',
  expertUserId: 'user_milica',
  employeeUserId: 'user_jovan',
  startsAt: new Date('2026-11-24T15:00:00.000Z'),
  endsAt: new Date('2026-11-24T15:50:00.000Z'),
  status: 'awaiting_approval',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: 'appt_done',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
};

describe('NotConfiguredFollowUpApproval', () => {
  it('throws 409 approver_missing and audits the missing approver with the employee’s unit', async () => {
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const memberships = { findActiveByUserAndOrg: vi.fn().mockResolvedValue({ orgUnitId: 'ou_dev' }) };
    const tx = {};
    const requester = new NotConfiguredFollowUpApproval(audit as never, memberships as never);

    const error = await requester.request(FOLLOW_UP, tx as never, 'user_jovan').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpException);
    expect((error as ApiHttpException).getStatus()).toBe(409);
    expect((error as ApiHttpException).code).toBe('approver_missing');

    expect(memberships.findActiveByUserAndOrg).toHaveBeenCalledWith('user_jovan', 'org_sample', tx);
    expect(audit.record).toHaveBeenCalledWith({
      action: 'appointment.approval.missing_approver',
      actorUserId: 'user_jovan',
      actorKind: 'USER',
      orgId: 'org_sample',
      recordType: 'appointment',
      recordId: 'appt_next',
      result: 'DENIED',
      details: { appointmentId: 'appt_next', orgId: 'org_sample', orgUnitId: 'ou_dev' },
    });
  });

  it('records a null unit when the employee has no active membership', async () => {
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const memberships = { findActiveByUserAndOrg: vi.fn().mockResolvedValue(null) };
    const requester = new NotConfiguredFollowUpApproval(audit as never, memberships as never);
    await expect(requester.request(FOLLOW_UP, {} as never, 'user_milica')).rejects.toBeInstanceOf(ApiHttpException);
    expect(audit.record.mock.calls[0]![0].details).toEqual({ appointmentId: 'appt_next', orgId: 'org_sample', orgUnitId: null });
  });
});
