/**
 * Maps a failed access-management call to a translation key under
 * `workspace:access.errors.*`. The API's own `message` is English and meant
 * for developers, so it is never rendered.
 *
 * `null` means the user cancelled step-up: not a failure, nothing to show.
 * `step_up_required` itself is handled by `withStepUp` and has no copy.
 */
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from '../../auth';

export type AccessErrorKey =
  | 'missingConditions'
  | 'subjectNotMember'
  | 'templateInactive'
  | 'delegationExceedsBoundary'
  | 'rateLimited'
  | 'conflict'
  | 'ownerExists'
  | 'notOwner'
  | 'alreadyOwner'
  | 'unknown';

const BY_CODE: Record<string, AccessErrorKey> = {
  missing_conditions: 'missingConditions',
  subject_not_member: 'subjectNotMember',
  template_inactive: 'templateInactive',
  delegation_exceeds_boundary: 'delegationExceedsBoundary',
  rate_limited: 'rateLimited',
  conflict: 'conflict',
  owner_exists: 'ownerExists',
};

export function accessErrorKey(err: unknown): AccessErrorKey | null {
  if (err instanceof StepUpCancelledError) return null;
  if (err instanceof ApiError) {
    if (err.status === 429) return 'rateLimited';
    const mapped = BY_CODE[err.code];
    if (mapped) return mapped;
    if (err.status === 409) return 'conflict';
  }
  return 'unknown';
}

/**
 * Ownership transfer reuses the shared mapping, with two codes read in its
 * own terms: `forbidden` means the caller is no longer the owner, and
 * `conflict` means the chosen member already holds the owner grant.
 */
export function transferErrorKey(err: unknown): AccessErrorKey | null {
  if (err instanceof ApiError && err.status !== 429) {
    if (err.code === 'forbidden') return 'notOwner';
    if (err.code === 'conflict') return 'alreadyOwner';
  }
  return accessErrorKey(err);
}
