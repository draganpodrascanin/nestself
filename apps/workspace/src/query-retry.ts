/**
 * Retry policy for TanStack Query: a 4xx answer will not change on retry,
 * so it fails at once and its alert shows straight away (the default three
 * retries delayed it by about 7 seconds). A cancelled step-up is the user's
 * answer, and a retry of a read wrapped in `withStepUp` would open the
 * dialog again, so it fails at once too. 5xx answers, network failures
 * (`ApiError` with status 0, code `network`) and other errors are retried
 * up to three times.
 */
import { ApiError } from '@nestself/api-client';
import { StepUpCancelledError } from './auth/with-step-up';

const MAX_RETRIES = 3;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof StepUpCancelledError) return false;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}
