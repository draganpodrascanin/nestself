import { createApiClient } from '@nestself/api-client';

/**
 * The workspace API client.
 *
 * Cookie mode: session cookies + CSRF (CLIENT-R-28).
 * In sample mode, auth calls go through SampleAuthProvider instead;
 * the client is still created for healthQueryOptions and future API calls.
 */
export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  mode: 'cookie',
});
