/**
 * A `Principal` for a user who is not making the request: a background job
 * acting for its requester, or a service checking what another user may do
 * (the expert of a new appointment). The context comes from the caller; the
 * auth snapshot is deliberately old and without a second factor, so such a
 * principal never satisfies a step-up requirement.
 */
import type { ActiveContext, Principal } from '@nestself/contracts';
import type { LoadedPrincipal } from './principal-loader.js';

export function assemblePrincipal(loaded: LoadedPrincipal, context: ActiveContext): Principal {
  return {
    userId: loaded.userId,
    displayName: loaded.displayName,
    initials: loaded.initials,
    locale: loaded.locale,
    memberships: loaded.memberships,
    staffTemplates: loaded.staffTemplates,
    expert: loaded.expert,
    context,
    auth: {
      method: 'sso',
      time: new Date(0).toISOString(),
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: null,
    tokenFamily: null,
  };
}
