/**
 * Sample mode (VITE_DATA_SOURCE=sample): consultations come from
 * `SAMPLE_APPOINTMENTS` and names from `SAMPLE_PEOPLE`; nothing is sent.
 * An expert sees their own consultations; operations see the sample
 * organisation's, as `GET /appointments` answers them.
 */
import { SAMPLE_APPOINTMENTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import type { Appointment } from '@nestself/contracts';

export function sampleConsultationsFor(userId: string | undefined, operations: boolean): Appointment[] {
  if (operations) return [...SAMPLE_APPOINTMENTS];
  return SAMPLE_APPOINTMENTS.filter((appointment) => !!userId && appointment.expertUserId === userId);
}

export function sampleConsultation(appointmentId: string, userId: string | undefined): Appointment | null {
  return SAMPLE_APPOINTMENTS.find((appointment) => appointment.id === appointmentId && appointment.expertUserId === userId) ?? null;
}

/**
 * A participant's first name (CALL-18). Only sample mode knows names: the
 * appointment contract carries user ids, so API mode shows a neutral label.
 */
export function sampleFirstName(userId: string): string | null {
  const person = SAMPLE_PEOPLE.find((candidate) => candidate.id === userId);
  return person ? (person.displayName.split(' ')[0] ?? null) : null;
}
