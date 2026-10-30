/**
 * Route guards for the consultation routes of the admin app (CW-R-58). A
 * convenience only: the API authorises every appointment and call route and
 * answers 404 to anyone who is not a participant (CALL-17).
 */
import { redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import type { Principal } from '@nestself/contracts';
import { resolveRouteAuth } from '../auth';
import type { RouterAuth } from '../auth';
import { isSampleDataMode } from '../data-source';

/** The expert's consultation actions: join the call and record the delivery outcome. */
export function isConsultingExpert(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return !!principal && can(principal, 'consultation.join', undefined, effectiveActions) && can(principal, 'delivery.record', undefined, effectiveActions);
}

/** Operations coordinating bookings for assigned clients (or platform-wide) read the list only. */
export function isCoordinatingOperations(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return !!principal && can(principal, 'bookings.coordinate', undefined, effectiveActions);
}

export function canListConsultations(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return isConsultingExpert(principal, effectiveActions) || isCoordinatingOperations(principal, effectiveActions);
}

async function guard(auth: RouterAuth, allowed: (principal: Principal, actions: readonly string[]) => boolean): Promise<void> {
  const { principal, effectiveActions } = await resolveRouteAuth(auth);
  // Sample mode fills the session after the first load; the screen checks again.
  if (!principal) {
    if (isSampleDataMode) return;
    throw redirect({ to: '/sign-in' });
  }
  if (!allowed(principal, effectiveActions)) throw redirect({ to: '/' });
}

export const requireConsultationList = (auth: RouterAuth) => guard(auth, canListConsultations);
export const requireConsultingExpert = (auth: RouterAuth) => guard(auth, isConsultingExpert);
