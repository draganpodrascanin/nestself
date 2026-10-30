/**
 * Route guards for the webinar routes (guidelines 12.1). A convenience only:
 * the API authorises every webinar route with `event.register` and the
 * audience policy, and answers 404 to anyone outside the audience.
 */
import { redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import type { Principal } from '@nestself/contracts';
import { resolveRouteAuth } from '../auth';
import type { RouterAuth } from '../auth';
import { isSampleDataMode } from '../data-source';

export const WEBINAR_ACTION = 'event.register';

export function canAttendWebinars(principal: Principal | null, effectiveActions: readonly string[]): boolean {
  return !!principal && can(principal, WEBINAR_ACTION, undefined, effectiveActions);
}

/**
 * Lets the route load when the session holds `event.register`. Without a
 * session: sign-in (API mode) or no decision yet (sample mode, where the
 * sample provider fills the session after the first load and the screen
 * checks again). Without the action: home, with the denial notice.
 */
export async function requireWebinarAccess(auth: RouterAuth, returnPath: string): Promise<void> {
  const { principal, effectiveActions } = await resolveRouteAuth(auth);
  if (!principal) {
    if (isSampleDataMode) return;
    throw redirect({ to: '/sign-in', search: { return: returnPath } });
  }
  if (!canAttendWebinars(principal, effectiveActions)) {
    throw redirect({ to: '/', search: { denied: 'webinars' } });
  }
}
