/**
 * The session as route guards see it.
 *
 * On a full page load the router runs `beforeLoad` before `AuthProvider` has
 * read `GET /auth/me`, so a guard that only looked at `context.auth.principal`
 * redirected every deep link to /sign-in. Guards call `resolveRouteAuth`
 * instead: until the provider has settled, it waits for the first `/auth/me`
 * (shared with the provider, so the page makes one request).
 */
import { ApiError, createAuthApi } from '@nestself/api-client';
import type { ApiClient } from '@nestself/api-client';
import type { MeResponse } from '@nestself/contracts';
import type { AuthSnapshot } from './types';

export interface RouterAuth extends AuthSnapshot {
  /**
   * True once the provider has a result for the session: signed in or signed
   * out. A `/auth/me` that failed is no result, so guards keep asking `ensure`.
   */
  settled?: boolean;
  /** Resolves the session for guards while the provider is still loading. */
  ensure?: () => Promise<AuthSnapshot>;
}

/** How long the page waits for `GET /auth/me` before it reports the session as unavailable. */
export const ME_TIMEOUT_MS = 10_000;

/**
 * `GET /auth/me` could not say whether there is a session: the API answered
 * with something other than a session or a 401, did not answer within
 * `ME_TIMEOUT_MS`, or could not be reached. That is not "signed out", so a
 * guard fails with this error (the `_authenticated` route renders a retry
 * state for it) instead of sending the user to /sign-in.
 */
export class SessionUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Session could not be loaded', options);
    this.name = 'SessionUnavailableError';
  }
}

const initialRequests = new WeakMap<ApiClient, Promise<MeResponse>>();

/**
 * The page's first `GET /auth/me`, shared by the guards of the first
 * navigation and the provider's initial load. The provider releases it once
 * its own state holds the result, whether that is a session or a failure;
 * later callers then make a fresh request.
 */
export function initialMe(client: ApiClient): Promise<MeResponse> {
  let pending = initialRequests.get(client);
  if (!pending) {
    pending = createAuthApi(client).me({ signal: AbortSignal.timeout(ME_TIMEOUT_MS) });
    initialRequests.set(client, pending);
  }
  return pending;
}

/** Called by the provider once it has applied the initial response. */
export function releaseInitialMe(client: ApiClient): void {
  initialRequests.delete(client);
}

/**
 * The first session snapshot. A 401 is a signed-out snapshot; any other
 * failure (an error answer, no answer in time, no connection) throws
 * `SessionUnavailableError`, because the user may well be signed in.
 */
export async function initialSnapshot(client: ApiClient): Promise<AuthSnapshot> {
  try {
    const me = await initialMe(client);
    return { principal: me.principal, effectiveActions: me.effectiveActions };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return { principal: null, effectiveActions: [] };
    }
    throw new SessionUnavailableError({ cause: err });
  }
}

/** The snapshot a guard decides on: waits for the session when it is not known yet. */
export async function resolveRouteAuth(auth: RouterAuth): Promise<AuthSnapshot> {
  if (auth.principal || auth.settled || !auth.ensure) return auth;
  return auth.ensure();
}
