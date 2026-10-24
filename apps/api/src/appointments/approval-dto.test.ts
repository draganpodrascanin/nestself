/**
 * The approver's view of a follow-up approval item (T-CW-1.10, D-CW-37,
 * CW-R-119, LAW-14): ids, status and four facts, nothing else.
 */
import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_APPROVAL_ITEM_FIELDS,
  APPROVAL_FOLLOW_UP_DESCRIPTION,
  AppointmentApprovalItemSchema,
} from '@nestself/contracts';
import { toApprovalItem, toContractApprovalStatus, toDbApprovalStatus } from './approval-dto.js';
import type { AppointmentRecord } from './appointments.repository.js';
import type { ApprovalRow } from './approval.repository.js';

const APPOINTMENT: AppointmentRecord = {
  id: 'appt_next',
  orgId: 'org_sample',
  expertUserId: 'user_milica',
  employeeUserId: 'user_jovan',
  startsAt: new Date('2026-11-24T15:00:00.000Z'),
  endsAt: new Date('2026-11-24T15:50:00.000Z'),
  status: 'awaiting_approval',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: 'fund_secret',
  followUpOf: 'appt_done',
  suggestedWindows: null,
  proposedAt: new Date('2026-11-01T00:00:00.000Z'),
  respondedAt: new Date('2026-11-02T00:00:00.000Z'),
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
};

const ROW: ApprovalRow = {
  id: 'appr_1',
  appointmentId: 'appt_next',
  orgId: 'org_sample',
  orgUnitId: 'team_product',
  approverUserId: 'user_stefan',
  alternateUserId: 'user_ivana',
  status: 'REJECTED',
  reason: 'Not this month.',
  decidedAt: new Date('2026-11-03T00:00:00.000Z'),
  createdAt: new Date('2026-11-02T00:00:00.000Z'),
};

describe('toApprovalItem', () => {
  const item = toApprovalItem(ROW, APPOINTMENT, 'Jovan Petrović');

  it('carries exactly the ids, the status and the four facts', () => {
    expect(item).toEqual({
      id: 'appr_1',
      appointmentId: 'appt_next',
      status: 'rejected',
      employeeDisplayName: 'Jovan Petrović',
      description: APPROVAL_FOLLOW_UP_DESCRIPTION,
      startsAt: '2026-11-24T15:00:00.000Z',
      durationMinutes: 50,
    });
    expect(Object.keys(item).sort()).toEqual([...APPOINTMENT_APPROVAL_ITEM_FIELDS].sort());
    expect(AppointmentApprovalItemSchema.parse(item)).toEqual(item);
  });

  it('serialises without the category, the expert, the funding, the unit, the approvers or the reason', () => {
    const json = JSON.stringify(item);
    for (const secret of [
      'psychological',
      'user_milica',
      'fund_secret',
      'team_product',
      'user_stefan',
      'user_ivana',
      'user_jovan',
      'Not this month',
      'appt_done',
      'Europe/Belgrade',
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe('approval status spellings', () => {
  it('maps the stored upper case to the contract lower case and back', () => {
    expect(toContractApprovalStatus('PENDING')).toBe('pending');
    expect(toContractApprovalStatus('EXPIRED')).toBe('expired');
    expect(toDbApprovalStatus('approved')).toBe('APPROVED');
    expect(toDbApprovalStatus('rejected')).toBe('REJECTED');
  });
});
