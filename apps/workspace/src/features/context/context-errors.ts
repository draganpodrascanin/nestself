/**
 * Maps a failed `POST /auth/context` to a translation key under
 * `auth:context.picker.errors.*`. The API's own `message` is English and
 * meant for developers, so it is never rendered.
 */
import { ApiError } from '@nestself/api-client';

export type ContextErrorKey = 'invalidContext' | 'orgContextExpired' | 'rateLimited' | 'unknown';

export function contextErrorKey(err: unknown): ContextErrorKey {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'rateLimited';
    if (err.code === 'invalid_context') return 'invalidContext';
    if (err.code === 'org_context_expired') return 'orgContextExpired';
  }
  return 'unknown';
}
