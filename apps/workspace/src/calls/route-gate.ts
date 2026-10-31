/**
 * Route guards for the consultation routes (CW-R-58). A convenience only:
 * every appointment and call route is authorised on the server, which
 * answers 404 to anyone who is not a participant (CALL-17).
 */
import { redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import type { Principal } from '@nestself/contracts';
import { resolveRouteAuth } from '../auth';
import type { RouterAuth } from '../auth';
import { isSampleDataMode } from '../data-source';

export const CONSULTATION_ACTION = 'consultation.join';

export function canJoinConsultations(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return !!principal && can(principal, CONSULTATION_ACTION, undefined, effectiveActions);
}

/**
 * Lets the route load when the session holds `consultation.join`. Without
 * a session: sign-in (API mode) or no decision yet (sample mode, where the
 * sample provider fills the session after the first load and the screen
 * checks again). Without the action: home, with the denial notice.
 */
export async function requireConsultationAccess(auth: RouterAuth, returnPath: string): Promise<void> {
  const { principal, effectiveActions } = await resolveRouteAuth(auth);
  if (!principal) {
    if (isSampleDataMode) return;
    throw redirect({ to: '/sign-in', search: { return: returnPath } });
  }
  if (!canJoinConsultations(principal, effectiveActions)) {
    throw redirect({ to: '/', search: { denied: 'appointments' } });
  }
}
