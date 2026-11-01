/**
 * Maps a failed listening call to a key under `listening:errors.*`. The API's
 * own `message` is English and written for developers, so it is never
 * rendered; an unknown code still gets `unknown` (CLAUDE.md, error states).
 * `null` means the user cancelled a step-up: nothing to show.
 */
import { ApiError } from '@nestself/api-client';
import { FEEDBACK_ERROR_CODES, LISTENING_ERROR_CODES, REVIEW_ERROR_CODES } from '@nestself/contracts';
import { StepUpCancelledError } from '../../auth';

export type ListeningErrorKey =
  | (typeof LISTENING_ERROR_CODES)[number]
  | (typeof FEEDBACK_ERROR_CODES)[number]
  | (typeof REVIEW_ERROR_CODES)[number]
  | 'validation'
  | 'forbidden'
  | 'notFound'
  | 'contextMismatch'
  | 'rateLimited'
  | 'conflict'
  | 'unknown';

const BY_CODE: Record<string, ListeningErrorKey> = {
  validation: 'validation',
  forbidden: 'forbidden',
  not_found: 'notFound',
  context_mismatch: 'contextMismatch',
  invalid_context: 'contextMismatch',
  org_context_expired: 'contextMismatch',
  rate_limited: 'rateLimited',
  conflict: 'conflict',
};

export function listeningErrorKey(err: unknown): ListeningErrorKey | null {
  if (err instanceof StepUpCancelledError) return null;
  if (err instanceof ApiError) {
    if (err.status === 429) return 'rateLimited';
    if (([...LISTENING_ERROR_CODES, ...FEEDBACK_ERROR_CODES, ...REVIEW_ERROR_CODES] as readonly string[]).includes(err.code)) return err.code as ListeningErrorKey;
    const mapped = BY_CODE[err.code];
    if (mapped) return mapped;
    if (err.status === 404) return 'notFound';
    if (err.status === 403) return 'forbidden';
    if (err.status === 409) return 'conflict';
  }
  return 'unknown';
}

/** The translation key for an error, or null when nothing should be shown. */
export function listeningErrorMessageKey(err: unknown): `listening:errors.${ListeningErrorKey}` | null {
  const key = listeningErrorKey(err);
  return key ? `listening:errors.${key}` : null;
}
