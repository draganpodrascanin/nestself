/**
 * Appointment mappers: the API response (the contract seam, CALL-31) and the
 * authorization resource.
 */
import type { AppointmentResponse, Resource } from '@nestself/contracts';
import type { AppointmentRecord } from './appointments.repository.js';

/** Exactly the seam fields; nothing else leaves the module. */
export function toAppointmentResponse(record: AppointmentRecord): AppointmentResponse {
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
  };
}

/**
 * The resource `authorize()` evaluates for one appointment. The employee
 * reaches it through the `employee` template (`own` scope: `ownerId`); the
 * expert through the `expert` template (`assigned_cases` scope: a CASE
 * assignment whose target is `id`). Nobody else holds a grant whose scope
 * covers it. The service category is not set as `category`: the expert
 * grant's `categories` condition holds credential categories in another
 * spelling, and eligibility is checked when the appointment is created.
 */
export function appointmentResourceOf(
  record: Pick<AppointmentRecord, 'id' | 'orgId' | 'employeeUserId'>,
): Resource {
  return { type: 'appointment', id: record.id, orgId: record.orgId, ownerId: record.employeeUserId };
}
