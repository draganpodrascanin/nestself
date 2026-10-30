/**
 * Appointment mappers: the API response (the contract seam, CALL-31), the
 * authorization resource and the list cursor.
 */
import type {
  AppointmentEmployeeDisplay,
  AppointmentExpertDisplay,
  AppointmentResponse,
  Resource,
} from '@nestself/contracts';
import type { AppointmentKey, AppointmentRecord } from './appointments.repository.js';

/** The participants as the response names them (`AppointmentsRepository.participantsOf`). */
export interface AppointmentParticipants {
  expert: AppointmentExpertDisplay;
  employee: AppointmentEmployeeDisplay;
}

/**
 * The first name inside a display name: its first word. `users` stores one
 * display name, so this is the only part of it that leaves the API (never a
 * surname). Null for a blank name.
 */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * The seam fields, the participants' display names when given, and the
 * employee's suggested windows when there are some (CALL-37); nothing else
 * leaves the module (`proposedAt` and `respondedAt` stay inside).
 */
export function toAppointmentResponse(record: AppointmentRecord, participants?: AppointmentParticipants): AppointmentResponse {
  const suggestedWindows = record.suggestedWindows?.length ? { suggestedWindows: record.suggestedWindows } : {};
  return {
    id: record.id,
    orgId: record.orgId,
    expertUserId: record.expertUserId,
    employeeUserId: record.employeeUserId,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    status: record.status,
    serviceCategory: record.serviceCategory,
    timeZone: record.timeZone,
    fundingRef: record.fundingRef,
    followUpOf: record.followUpOf,
    ...(participants ? { expert: participants.expert, employee: participants.employee } : {}),
    ...suggestedWindows,
  };
}

/**
 * The resource `authorize()` evaluates for one appointment. The employee
 * reaches it through the `employee` template (`own` scope: `ownerId`); the
 * expert through the `expert` template (`assigned_cases` scope: a CASE
 * assignment whose target is `id`), whose required `categories` condition is
 * checked against `category`. Nobody else holds a grant whose scope covers it.
 */
export function appointmentResourceOf(
  record: Pick<AppointmentRecord, 'id' | 'orgId' | 'employeeUserId' | 'serviceCategory'>,
): Resource {
  return {
    type: 'appointment',
    id: record.id,
    orgId: record.orgId,
    ownerId: record.employeeUserId,
    category: record.serviceCategory,
  };
}

/** The opaque `nextCursor`: the `(startsAt, id)` key of a page's last row, base64url JSON. */
export function encodeAppointmentCursor(key: AppointmentKey): string {
  return Buffer.from(JSON.stringify([key.startsAt.toISOString(), key.id])).toString('base64url');
}

/** The key inside a cursor, or null when it is not one this API issued. */
export function decodeAppointmentCursor(cursor: string): AppointmentKey | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [startsAt, id] = value as unknown[];
    if (typeof startsAt !== 'string' || typeof id !== 'string' || id.length === 0) return null;
    const date = new Date(startsAt);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== startsAt) return null;
    return { startsAt: date, id };
  } catch {
    return null;
  }
}
