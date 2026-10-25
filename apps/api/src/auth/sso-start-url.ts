/**
 * The absolute `GET /api/auth/sso/start` URL handed to clients by discovery,
 * invitation acceptance and the staff test endpoint (D-12 decision table:
 * built from `API_PUBLIC_URL` so `DiscoverResponseSchema`'s `.url()` holds).
 */
export const DEFAULT_API_PUBLIC_URL = 'http://localhost:4000';

export function apiPublicUrlFrom(value: string | undefined | null): string {
  return (value || DEFAULT_API_PUBLIC_URL).replace(/\/+$/, '');
}

export function buildSsoStartUrl(
  apiPublicUrl: string,
  input: { connection: string; surface: 'workspace' | 'admin'; returnPath?: string; test?: boolean },
): string {
  const query = new URLSearchParams({ connection: input.connection, surface: input.surface });
  if (input.returnPath) query.set('returnPath', input.returnPath);
  if (input.test) query.set('test', '1');
  return `${apiPublicUrl}/api/auth/sso/start?${query.toString()}`;
}
