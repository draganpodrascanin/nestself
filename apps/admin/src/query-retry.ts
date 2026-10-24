/**
 * Retry policy for TanStack Query: a 4xx answer will not change on retry,
 * so it fails at once and its alert shows straight away (the default three
 * retries delayed it by about 7 seconds). 5xx answers, network failures and
 * other errors are retried up to three times.
 */
import { ApiError } from '@nestself/api-client';

const MAX_RETRIES = 3;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}
