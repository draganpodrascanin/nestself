/**
 * Sample mode (VITE_DATA_SOURCE=sample): appointments come from
 * `SAMPLE_APPOINTMENTS` and names from `SAMPLE_PEOPLE`; nothing is sent.
 * A participant sees only their own appointments, as on the API.
 */
import { SAMPLE_APPOINTMENTS, SAMPLE_APPROVAL_ITEMS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import { AppointmentApprovalItemSchema } from '@nestself/contracts';
import type { Appointment, AppointmentApprovalItem } from '@nestself/contracts';

function isParticipant(appointment: Appointment, userId: string | undefined): boolean {
  return !!userId && (appointment.employeeUserId === userId || appointment.expertUserId === userId);
}

export function sampleAppointmentsFor(userId: string | undefined): Appointment[] {
  return SAMPLE_APPOINTMENTS.filter((appointment) => isParticipant(appointment, userId));
}

export function sampleAppointment(appointmentId: string, userId: string | undefined): Appointment | null {
  return SAMPLE_APPOINTMENTS.find((appointment) => appointment.id === appointmentId && isParticipant(appointment, userId)) ?? null;
}

/**
 * A participant's first name in sample mode. In API mode the appointment
 * response carries it (`expert.firstName`, `employee.firstName`).
 */
export function sampleFirstName(userId: string): string | null {
  const person = SAMPLE_PEOPLE.find((candidate) => candidate.id === userId);
  return person ? (person.displayName.split(' ')[0] ?? null) : null;
}

const APPROVAL_ITEM_FIELDS = ['id', 'appointmentId', 'status', 'employeeDisplayName', 'description', 'startsAt', 'durationMinutes', 'timeZone'] as const;

/**
 * The sample approver's follow-up approval items (`SAMPLE_APPROVAL_ITEMS`),
 * each reduced to the four facts the approver may see (the `sample` marker
 * dropped) and checked against the API's item schema.
 */
export function sampleApprovalItems(): AppointmentApprovalItem[] {
  return SAMPLE_APPROVAL_ITEMS.flatMap((item) => {
    const parsed = AppointmentApprovalItemSchema.safeParse(Object.fromEntries(APPROVAL_ITEM_FIELDS.map((field) => [field, item[field]])));
    return parsed.success ? [parsed.data] : [];
  });
}
