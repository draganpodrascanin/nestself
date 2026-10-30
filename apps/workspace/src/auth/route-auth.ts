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
  /** True once the provider has a result for the session (authenticated or not). */
  settled?: boolean;
  /** Resolves the session for guards while the provider is still loading. */
  ensure?: () => Promise<AuthSnapshot>;
}

const initialRequests = new WeakMap<ApiClient, Promise<MeResponse>>();

/**
 * The page's first `GET /auth/me`, shared by the guards of the first
 * navigation and the provider's initial load. The provider releases it once
 * its own state holds the result; later callers then make a fresh request.
 */
export function initialMe(client: ApiClient): Promise<MeResponse> {
  let pending = initialRequests.get(client);
  if (!pending) {
    pending = createAuthApi(client).me();
    initialRequests.set(client, pending);
  }
  return pending;
}

/** Called by the provider once it has applied the initial response. */
export function releaseInitialMe(client: ApiClient): void {
  initialRequests.delete(client);
}

/** The first session snapshot: a signed-out snapshot when `/auth/me` fails. */
export async function initialSnapshot(client: ApiClient): Promise<AuthSnapshot> {
  try {
    const me = await initialMe(client);
    return { principal: me.principal, effectiveActions: me.effectiveActions, availableContexts: me.availableContexts };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      // Not a signed-out answer, but the guard cannot let the user in either.
      console.warn('Session could not be loaded', err);
    }
    return { principal: null, effectiveActions: [], availableContexts: [] };
  }
}

/** The snapshot a guard decides on: waits for the session when it is not known yet. */
export async function resolveRouteAuth(auth: RouterAuth): Promise<AuthSnapshot> {
  if (auth.principal || auth.settled || !auth.ensure) return auth;
  return auth.ensure();
}
