/**
 * Shared auth types for the workspace app.
 * CLIENT-R-01..04: useAuth() shape.
 */
import type { Principal, ActiveContext, AvailableContextEntry } from '@nestself/contracts';

/**
 * `error`: `GET /auth/me` failed for a reason other than 401 (an error
 * answer, no answer in time, no connection), so it is not known whether the
 * user is signed in. `principal` keeps what the provider had before.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthSnapshot {
  principal: Principal | null;
  effectiveActions: readonly string[];
  availableContexts: readonly AvailableContextEntry[];
}

export interface AuthContextValue extends AuthSnapshot {
  /** CLIENT-R-01: current auth status. */
  status: AuthStatus;
  /** CLIENT-R-03: sign out, clear session. */
  signOut: () => Promise<void>;
  /** CLIENT-R-04: switch the active context (org / personal / expert / operations). */
  switchContext: (context: ActiveContext) => Promise<void>;
  /**
   * CLIENT-R-04: request step-up authentication. Opens the step-up dialog and
   * resolves `true` once the user verified, `false` when they cancelled.
   */
  stepUp: () => Promise<boolean>;
  /** CLIENT-R-02: re-fetch the principal from the server. */
  refreshPrincipal: () => Promise<void>;
  /** Non-null when a background refresh or action failed. */
  error: Error | null;
}
