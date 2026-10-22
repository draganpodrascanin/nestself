/**
 * @Authenticated() decorator — marks a route as requiring a valid session
 * or bearer token, but no specific authorization action.
 *
 * The AuthorizationGuard treats this as "principal must be present, no action check".
 * The default-deny test accepts @Public(), @Authenticated() or @Authorize().
 *
 * @see AUTHZ-R-49, T-1.6
 */
import { SetMetadata } from '@nestjs/common';

export const IS_AUTHENTICATED_ONLY_KEY = 'isAuthenticatedOnly';
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED_ONLY_KEY, true);
