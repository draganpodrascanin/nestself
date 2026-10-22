import type { z } from 'zod';
import { ApiError } from './errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CLIENT-R-28: cookie mode for same-origin SPAs, bearer for mobile/SSR. */
export type ApiClientMode = 'cookie' | 'bearer';

export interface ApiClientOptions {
  baseUrl: string;
  /** When omitted: `'bearer'` if `getToken` is provided, `'cookie'` otherwise. */
  mode?: ApiClientMode;
  /** Bearer token supplier. Rejected when mode is `'cookie'`. */
  getToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** CSRF cookie names tried in order (cookie mode only). */
  csrfCookieNames?: string[];
}

export interface ApiClient {
  request<T>(
    path: string,
    init: RequestInit & { schema: z.ZodType<T>; expectBody?: boolean },
  ): Promise<T>;
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const NON_BODY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const DEFAULT_CSRF_COOKIE_NAMES = ['__Host-nestself_csrf', 'nestself_csrf'];

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

function resolveCsrfToken(names: string[]): string | null {
  for (const name of names) {
    const value = readCookie(name);
    if (value) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const { baseUrl, getToken, fetchImpl = fetch, csrfCookieNames } = opts;

  // Resolve mode (CLIENT-R-28)
  const mode: ApiClientMode = opts.mode ?? (getToken ? 'bearer' : 'cookie');

  // Reject mixing: cookie mode must not have a token supplier
  if (mode === 'cookie' && getToken) {
    throw new Error(
      'Cannot use cookie mode with getToken. Cookie mode relies on ' +
        'httpOnly session cookies; bearer tokens must not be mixed in.',
    );
  }

  const csrfNames = csrfCookieNames ?? DEFAULT_CSRF_COOKIE_NAMES;

  return {
    baseUrl,

    async request<T>(
      path: string,
      init: RequestInit & { schema: z.ZodType<T>; expectBody?: boolean },
    ): Promise<T> {
      const { schema, expectBody, ...fetchInit } = init;
      const headers = new Headers(fetchInit.headers);
      headers.set('Accept', 'application/json');

      // Credentials (cookie mode)
      if (mode === 'cookie') {
        fetchInit.credentials = 'include';

        // CSRF token on mutating methods
        const method = (fetchInit.method ?? 'GET').toUpperCase();
        if (!NON_BODY_METHODS.has(method)) {
          const csrfToken = resolveCsrfToken(csrfNames);
          if (csrfToken) {
            headers.set('X-CSRF-Token', csrfToken);
          }
        }
      }

      // Bearer token
      if (mode === 'bearer' && getToken) {
        const token = await getToken();
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          ...fetchInit,
          headers,
        });
      } catch {
        throw new ApiError({
          status: 0,
          code: 'network',
          message: 'Network request failed',
          requestId: null,
        });
      }

      const requestId = response.headers.get('x-request-id');

      if (!response.ok) {
        let message: string = response.statusText;
        let code: string = String(response.status);
        let details: Record<string, unknown> | undefined;

        try {
          const body = (await response.json()) as Record<string, unknown>;
          if (typeof body.code === 'string') {
            code = body.code;
          }
          if (typeof body.message === 'string') {
            message = body.message;
          } else if (typeof body.error === 'string') {
            message = body.error;
          }
          if (body.details && typeof body.details === 'object') {
            details = body.details as Record<string, unknown>;
          }
        } catch {
          // use statusText as fallback
        }
        throw new ApiError({
          status: response.status,
          code,
          message,
          requestId,
          details,
        });
      }

      // Empty body handling (204, signOut, etc.)
      if (expectBody === false) {
        return undefined as unknown as T;
      }

      // Guard against unexpected empty body
      const text = await response.text();
      if (!text) {
        throw new ApiError({
          status: response.status,
          code: 'invalid_response',
          message: 'Response body is empty',
          requestId,
        });
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError({
          status: response.status,
          code: 'invalid_response',
          message: 'Response is not valid JSON',
          requestId,
        });
      }

      try {
        return schema.parse(json) as T;
      } catch {
        throw new ApiError({
          status: response.status,
          code: 'invalid_response',
          message: 'Response validation failed',
          requestId,
        });
      }
    },
  };
}
