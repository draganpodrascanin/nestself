/**
 * `appointmentResource`: the `@Authorize()` resource resolver for routes that
 * address an appointment by `:id` (guidelines 7.1). Those routes carry no
 * `:orgId`, so `orgResourceFromContext` cannot serve them; the resolver loads
 * the row and derives the organization, the owner (the employee) and the id
 * from it, and the guard's `authorize()` call decides (`appointmentResourceOf`).
 *
 * A missing row answers 404 here. Guidelines 7.1 sketch a placeholder
 * organization (`'__not_found__'`) instead; that id would reach the
 * `access.denied` audit row, whose `org_id` references `organizations`, and a
 * platform-scoped grant would match it. Throwing gives the same 404 without
 * either side effect.
 *
 * Resolvers are plain functions in decorator metadata, outside dependency
 * injection, so `AppointmentsModule` binds the repository at start-up
 * ({@link bindAppointmentLookup}). An unbound lookup throws (500): the route
 * fails closed.
 */
import type { Principal, Resource } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { ResourceResolver } from '../authz/authorize.decorator.js';
import { appointmentResourceOf } from './appointment-mapper.js';
import type { AppointmentRecord } from './appointments.repository.js';

export interface AppointmentLookup {
  findById(id: string): Promise<AppointmentRecord | null>;
}

let lookup: AppointmentLookup | null = null;

/** Called by `AppointmentsModule` on init (the repository) and on destroy (null). */
export function bindAppointmentLookup(next: AppointmentLookup | null): void {
  lookup = next;
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

export const appointmentResource: ResourceResolver = async (
  req: Record<string, unknown>,
  _principal: Principal,
): Promise<Resource> => {
  const id = (req['params'] as Record<string, string | undefined> | undefined)?.['id'];
  if (!id) throw notFound();
  if (!lookup) throw new Error('appointmentResource: AppointmentsModule has not bound the appointment lookup');
  const row = await lookup.findById(id);
  if (!row) throw notFound();
  return appointmentResourceOf(row);
};
