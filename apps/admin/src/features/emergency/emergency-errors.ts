/**
 * Maps a failed emergency access call to a translation key under
 * `admin:emergency.errors.*`. The API's own `message` is English and meant
 * for developers, so it is never rendered; an unknown code still gets
 * `unknown`.
 *
 * `null` means the user cancelled step-up: not a failure, nothing to show.
 * `step_up_required` itself is handled by `withStepUp` and has no copy.
 */
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from '../../auth';

export type EmergencyErrorKey =
  | 'selfApprovalDenied'
  | 'notActive'
  | 'conflict'
  | 'notFound'
  | 'forbidden'
  | 'validation'
  | 'rateLimited'
  | 'unknown';

const BY_CODE: Record<string, EmergencyErrorKey> = {
  self_approval_denied: 'selfApprovalDenied',
  emergency_not_active: 'notActive',
  conflict: 'conflict',
  not_found: 'notFound',
  forbidden: 'forbidden',
  validation: 'validation',
  rate_limited: 'rateLimited',
};

export function emergencyErrorKey(err: unknown): EmergencyErrorKey | null {
  if (err instanceof StepUpCancelledError) return null;
  if (err instanceof ApiError) {
    if (err.status === 429) return 'rateLimited';
    const mapped = BY_CODE[err.code];
    if (mapped) return mapped;
    if (err.status === 409) return 'conflict';
    if (err.status === 404) return 'notFound';
  }
  return 'unknown';
}
