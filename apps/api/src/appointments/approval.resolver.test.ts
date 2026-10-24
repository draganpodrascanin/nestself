import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { approvalResource, bindApprovalLookup } from './approval.resolver.js';
import type { ApprovalRow } from './approval.repository.js';

const ROW: ApprovalRow = {
  id: 'appr_1',
  appointmentId: 'appt_next',
  orgId: 'org_sample',
  orgUnitId: 'team_product',
  approverUserId: 'user_stefan',
  alternateUserId: 'user_ivana',
  status: 'PENDING',
  reason: null,
  decidedAt: null,
  createdAt: new Date('2026-11-02T00:00:00.000Z'),
};

const lookup = { findById: (id: string) => Promise.resolve(id === ROW.id ? ROW : null) };
const as = (userId: string) => ({ userId }) as Principal;
const req = (id?: string) => ({ params: id === undefined ? {} : { id } });

async function expectNotFound(promise: unknown): Promise<void> {
  const error = await Promise.resolve(promise).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiHttpException);
  expect((error as ApiHttpException).getStatus()).toBe(404);
  expect((error as ApiHttpException).code).toBe('not_found');
}

describe('approvalResource', () => {
  afterEach(() => bindApprovalLookup(null));

  it('gives the approver and the alternate the item’s organization and unit', async () => {
    bindApprovalLookup(lookup);
    const expected = { type: 'appointment_approval', id: 'appr_1', orgId: 'org_sample', orgUnitId: 'team_product' };
    await expect(approvalResource(req('appr_1'), as('user_stefan'))).resolves.toEqual(expected);
    await expect(approvalResource(req('appr_1'), as('user_ivana'))).resolves.toEqual(expected);
  });

  it('answers 404 to anybody else, to a missing item and without an id', async () => {
    bindApprovalLookup(lookup);
    await expectNotFound(approvalResource(req('appr_1'), as('user_ana')));
    await expectNotFound(approvalResource(req('appr_1'), as('user_jovan')));
    await expectNotFound(approvalResource(req('appr_missing'), as('user_stefan')));
    await expectNotFound(approvalResource(req(), as('user_stefan')));
  });

  it('leaves the unit out when the employee had none', async () => {
    bindApprovalLookup({ findById: () => Promise.resolve({ ...ROW, orgUnitId: null }) });
    await expect(approvalResource(req('appr_1'), as('user_stefan'))).resolves.toEqual({
      type: 'appointment_approval',
      id: 'appr_1',
      orgId: 'org_sample',
    });
  });

  it('fails closed when the lookup is not bound', async () => {
    await expect(approvalResource(req('appr_1'), as('user_stefan'))).rejects.toThrow(/has not bound/);
  });
});
