/**
 * The approver's view of a follow-up approval item (T-CW-1.10, D-CW-37,
 * CW-R-119, LAW-14). Built field by field from an allowlist: the item and
 * appointment ids, the status, the employee's display name, the fixed
 * description, the start and the duration. Never the service category, the
 * expert, the funding, the unit, who else may decide or the rejection reason.
 */
import {
  APPROVAL_FOLLOW_UP_DESCRIPTION,
  type AppointmentApprovalItem,
  type AppointmentApprovalStatus,
} from '@nestself/contracts';
import type { AppointmentRecord } from './appointments.repository.js';
import type { ApprovalRow, DbApprovalStatus } from './approval.repository.js';

const TO_CONTRACT: Readonly<Record<DbApprovalStatus, AppointmentApprovalStatus>> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

const TO_DB: Readonly<Record<AppointmentApprovalStatus, DbApprovalStatus>> = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  expired: 'EXPIRED',
};

export function toContractApprovalStatus(status: DbApprovalStatus): AppointmentApprovalStatus {
  return TO_CONTRACT[status];
}

export function toDbApprovalStatus(status: AppointmentApprovalStatus): DbApprovalStatus {
  return TO_DB[status];
}

export function durationMinutesOf(appointment: Pick<AppointmentRecord, 'startsAt' | 'endsAt'>): number {
  return Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000);
}

export function toApprovalItem(
  row: Pick<ApprovalRow, 'id' | 'appointmentId' | 'status'>,
  appointment: Pick<AppointmentRecord, 'startsAt' | 'endsAt'>,
  employeeDisplayName: string,
): AppointmentApprovalItem {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    status: toContractApprovalStatus(row.status),
    employeeDisplayName,
    description: APPROVAL_FOLLOW_UP_DESCRIPTION,
    startsAt: appointment.startsAt.toISOString(),
    durationMinutes: durationMinutesOf(appointment),
  };
}
