/**
 * Sample mode (VITE_DATA_SOURCE=sample): appointments come from
 * `SAMPLE_APPOINTMENTS` and names from `SAMPLE_PEOPLE`; nothing is sent.
 * A participant sees only their own appointments, as on the API.
 */
import { SAMPLE_APPOINTMENTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import type { Appointment } from '@nestself/contracts';

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
 * A participant's first name. Only sample mode knows names: the appointment
 * contract carries user ids, so API mode shows a neutral label until a
 * profile read exists.
 */
export function sampleFirstName(userId: string): string | null {
  const person = SAMPLE_PEOPLE.find((candidate) => candidate.id === userId);
  return person ? (person.displayName.split(' ')[0] ?? null) : null;
}
