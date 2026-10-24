/**
 * Maps a failed access-management call to a translation key under
 * `admin:access.errors.*`. The API's own `message` is English and meant for
 * developers, so it is never rendered.
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
  | 'notFound'
  | 'forbidden'
  | 'rateLimited'
  | 'conflict'
  | 'ownerExists'
  | 'alreadyOwner'
  | 'unknown';

const BY_CODE: Record<string, AccessErrorKey> = {
  missing_conditions: 'missingConditions',
  subject_not_member: 'subjectNotMember',
  template_inactive: 'templateInactive',
  not_found: 'notFound',
  forbidden: 'forbidden',
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
 * Ownership transfer reuses the shared mapping; `conflict` there means the
 * chosen member already holds the owner grant. `forbidden` keeps its staff
 * meaning (the caller may not manage this organization).
 */
export function transferErrorKey(err: unknown): AccessErrorKey | null {
  if (err instanceof ApiError && err.status !== 429 && err.code === 'conflict') return 'alreadyOwner';
  return accessErrorKey(err);
}

/**
 * The copy key for an error where the ID in question is a user's: a 404 then
 * means the user does not exist (user lookup, platform grant subject).
 */
export function userErrorMessageKey(key: AccessErrorKey): string {
  return key === 'notFound' ? 'admin:access.errors.userNotFound' : `admin:access.errors.${key}`;
}
