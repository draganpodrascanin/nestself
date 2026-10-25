/**
 * Where the SSO URLs of a surface live.
 *
 * **The API origin for a surface is that surface's own origin** (fix wave 2):
 * every SPA proxies `/api` to the API (CloudFront `/api/*` behaviours in AWS,
 * the Vite dev proxy locally), and the session cookie
 * `__Host-nestself_session` (Path=/, no Domain) binds to the exact host that
 * sets it. A `surface=admin` flow must therefore start, call back and set its
 * cookie on the admin origin, or `/api/auth/me` on the admin app never sees
 * the session. `API_PUBLIC_URL` stays the origin for mobile and direct
 * callers, and the fallback when a surface URL is unset (stub mode only:
 * cognito mode requires all three, `config/env.ts`).
 *
 * The callbacks used here are exactly the web client's registered
 * `webCallbackUrls` (`infra/cdk/lib/config.ts`): both SPA origins plus the
 * API origin.
 */
export type SsoSurface = 'workspace' | 'admin';

/** What these helpers read; `ConfigService` satisfies it. */
export interface SurfaceUrlConfig {
  get(key: string): string | undefined;
}

export const DEFAULT_API_PUBLIC_URL = 'http://localhost:4000';

export const SSO_CALLBACK_PATH = '/api/auth/sso/callback';

export function apiPublicUrlFrom(value: string | undefined | null): string {
  return (value || DEFAULT_API_PUBLIC_URL).replace(/\/+$/, '');
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

/**
 * `WORKSPACE_URL` origin for `workspace`, `ADMIN_URL` origin for `admin`;
 * `API_PUBLIC_URL` (then `http://localhost:4000`) only when the surface URL
 * is unset.
 */
export function apiOriginForSurface(config: SurfaceUrlConfig, surface: SsoSurface): string {
  const surfaceUrl = config.get(surface === 'admin' ? 'ADMIN_URL' : 'WORKSPACE_URL');
  if (surfaceUrl) return originOf(surfaceUrl);
  return originOf(apiPublicUrlFrom(config.get('API_PUBLIC_URL')));
}

/** The `redirect_uri` of a surface's flow: sent to the IdP and to the token exchange. */
export function ssoCallbackUrl(config: SurfaceUrlConfig, surface: SsoSurface): string {
  return `${apiOriginForSurface(config, surface)}${SSO_CALLBACK_PATH}`;
}

/**
 * Every callback the web client registers: workspace, admin and
 * `API_PUBLIC_URL` origins (deduplicated, in that order). The stub's fake
 * authorize hop accepts exactly these.
 */
export function registeredSsoCallbackUrls(config: SurfaceUrlConfig): string[] {
  const origins = [
    apiOriginForSurface(config, 'workspace'),
    apiOriginForSurface(config, 'admin'),
    originOf(apiPublicUrlFrom(config.get('API_PUBLIC_URL'))),
  ];
  return [...new Set(origins)].map((origin) => `${origin}${SSO_CALLBACK_PATH}`);
}

/**
 * The absolute `GET /api/auth/sso/start` URL handed to clients by discovery,
 * invitation acceptance and the staff test endpoint. `origin` must be
 * `apiOriginForSurface(surface)`: the start sets the browser-binding cookie,
 * which only reaches the callback on the same host.
 */
export function buildSsoStartUrl(
  origin: string,
  input: { connection: string; surface: SsoSurface; returnPath?: string; testNonce?: string },
): string {
  const query = new URLSearchParams({ connection: input.connection, surface: input.surface });
  if (input.returnPath) query.set('returnPath', input.returnPath);
  if (input.testNonce) query.set('test', input.testNonce);
  return `${origin.replace(/\/+$/, '')}/api/auth/sso/start?${query.toString()}`;
}
