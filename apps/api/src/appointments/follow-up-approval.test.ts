/**
 * The follow-up approval seam (D-CW-37, T-CW-1.9): until T-CW-1.10 binds the
 * approval service, a confirmation under `manager_approval` fails visibly with
 * 409 `approver_missing`; `FollowUpService` audits the missing approver.
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
  it('refuses with 409 approver_missing and touches nothing (FollowUpService audits after the rollback)', async () => {
    const tx = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    const error = await new NotConfiguredFollowUpApproval().request(FOLLOW_UP, tx as never, 'user_jovan').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpException);
    expect((error as ApiHttpException).getStatus()).toBe(409);
    expect((error as ApiHttpException).code).toBe('approver_missing');
    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
});
