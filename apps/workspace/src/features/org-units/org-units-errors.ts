/**
 * Maps a failed org-unit call to a translation key under
 * `workspace:orgUnits.errors.*`; `null` means the user cancelled step-up.
 */
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from '../../auth';

export type OrgUnitErrorKey =
  | 'validation'
  | 'notFound'
  | 'rootImmovable'
  | 'cycle'
  | 'invalidKind'
  | 'conflict'
  | 'rateLimited'
  | 'unknown';

const BY_CODE: Record<string, OrgUnitErrorKey> = {
  validation: 'validation',
  not_found: 'notFound',
  root_immovable: 'rootImmovable',
  cycle: 'cycle',
  invalid_kind: 'invalidKind',
  conflict: 'conflict',
  rate_limited: 'rateLimited',
};

export function orgUnitErrorKey(err: unknown): OrgUnitErrorKey | null {
  if (err instanceof StepUpCancelledError) return null;
  if (err instanceof ApiError) {
    if (err.status === 429) return 'rateLimited';
    const mapped = BY_CODE[err.code];
    if (mapped) return mapped;
    if (err.status === 409) return 'conflict';
  }
  return 'unknown';
}
