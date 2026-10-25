/**
 * Maps a failed client list or client read to a translation key under
 * `admin:organizations.errors.*`. The API's own `message` is never rendered;
 * an unknown code still gets `unknown`.
 */
import { ApiError } from '@nestself/api-client';

export type OrganizationErrorKey = 'notFound' | 'forbidden' | 'rateLimited' | 'unknown';

export function organizationErrorKey(err: unknown): OrganizationErrorKey {
  if (err instanceof ApiError) {
    if (err.status === 429 || err.code === 'rate_limited') return 'rateLimited';
    if (err.code === 'not_found' || err.status === 404) return 'notFound';
    // Only a plain `forbidden` means "not your client"; other 403 codes
    // (for example `csrf_rejected`) are not an access limit.
    if (err.code === 'forbidden') return 'forbidden';
  }
  return 'unknown';
}
