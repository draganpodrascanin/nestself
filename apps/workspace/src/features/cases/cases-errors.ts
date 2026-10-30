/**
 * Maps a failed professional-domain read to a translation key under
 * `workspace:cases.errors.*`. The API's own `message` is English and meant
 * for developers, so it is never rendered. A cancelled step-up is its own
 * key: nothing failed, but the content stays closed and the screen says so.
 */
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from '../../auth';

export type CasesErrorKey = 'stepUpCancelled' | 'forbidden' | 'notFound' | 'rateLimited' | 'unknown';

export function casesErrorKey(err: unknown): CasesErrorKey {
  if (err instanceof StepUpCancelledError) return 'stepUpCancelled';
  if (err instanceof ApiError) {
    if (err.status === 429) return 'rateLimited';
    if (err.status === 404) return 'notFound';
    if (err.status === 403) return 'forbidden';
  }
  return 'unknown';
}
