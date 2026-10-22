import { createApiClient } from '@nestself/api-client';

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  // Cookie mode: session cookies + CSRF (CLIENT-R-28).
  // In sample mode, auth calls go through SampleAuthProvider instead.
  mode: 'cookie',
});
