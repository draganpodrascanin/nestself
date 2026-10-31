/**
 * @RedirectOnThrottle() — marks a browser-navigation route (the SSO start and
 * callback). When its throttle refuses a request, `AppThrottlerGuard` sends
 * the browser to the workspace `/sign-in?reason=sso_rate_limited` with a 302
 * instead of the JSON 429 the browser would show as raw text.
 *
 * @see 5.9 Throttling and proxies
 */
import { SetMetadata } from '@nestjs/common';

export const REDIRECT_ON_THROTTLE = 'redirectOnThrottle';
export const RedirectOnThrottle = () => SetMetadata(REDIRECT_ON_THROTTLE, true);
