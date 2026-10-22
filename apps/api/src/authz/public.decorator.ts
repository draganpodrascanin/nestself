/**
 * @Public() decorator — marks a route as publicly accessible.
 * Bypasses AuthenticationGuard and AuthorizationGuard.
 *
 * @see AUTHZ-R-49, D-19
 */
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
