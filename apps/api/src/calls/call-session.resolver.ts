/**
 * `callSessionResource`: the `@Authorize()` resolver for routes that address
 * a call session by `:sessionId` (`POST /calls/:sessionId/client-events`,
 * guidelines 7.2 "participant from session"). It loads the session and its
 * appointment and returns the appointment resource, so `authorize()` applies
 * the same rule as the appointment routes: the employee through the `own`
 * scope, the expert through the CASE assignment. A missing session, or one
 * that belongs to no appointment yet (webinars arrive with T-CW-2.1),
 * answers 404.
 *
 * Resolvers are plain functions in decorator metadata, outside dependency
 * injection, so `CallsModule` binds the lookup at start-up; an unbound lookup
 * throws (500) and the route fails closed.
 */
import type { Principal, Resource } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { ResourceResolver } from '../authz/authorize.decorator.js';
import { appointmentResourceOf } from '../appointments/appointment-mapper.js';
import type { AppointmentRecord } from '../appointments/appointments.repository.js';

export interface CallSessionLookup {
  findSessionById(id: string): Promise<{ appointmentId: string | null } | null>;
  findAppointmentById(id: string): Promise<AppointmentRecord | null>;
}

let lookup: CallSessionLookup | null = null;

/** Called by `CallsModule` on init (the repositories) and on destroy (null). */
export function bindCallSessionLookup(next: CallSessionLookup | null): void {
  lookup = next;
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

/**
 * The appointment a call session belongs to, or null for a missing session,
 * one with no appointment (a webinar) or a missing appointment. Shared by
 * this resolver and the `call:{sessionId}` room resolver of `CallsService`,
 * so a route and a room subscription derive the same resource.
 */
export async function appointmentOfCallSession(
  sessions: CallSessionLookup,
  sessionId: string,
): Promise<AppointmentRecord | null> {
  const session = await sessions.findSessionById(sessionId);
  if (!session?.appointmentId) return null;
  return sessions.findAppointmentById(session.appointmentId);
}

export const callSessionResource: ResourceResolver = async (
  req: Record<string, unknown>,
  _principal: Principal,
): Promise<Resource> => {
  const sessionId = (req['params'] as Record<string, string | undefined> | undefined)?.['sessionId'];
  if (!sessionId) throw notFound();
  if (!lookup) throw new Error('callSessionResource: CallsModule has not bound the call session lookup');
  const appointment = await appointmentOfCallSession(lookup, sessionId);
  if (!appointment) throw notFound();
  return appointmentResourceOf(appointment);
};
