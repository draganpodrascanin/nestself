/**
 * Shared auth types for the admin app.
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
  /** CLIENT-R-01 */
  status: AuthStatus;
  /** CLIENT-R-03 */
  signOut: () => Promise<void>;
  /** CLIENT-R-04 */
  switchContext: (context: ActiveContext) => Promise<void>;
  /**
   * CLIENT-R-04: request step-up authentication. Opens the step-up dialog and
   * resolves `true` once the user verified, `false` when they cancelled.
   */
  stepUp: () => Promise<boolean>;
  /** CLIENT-R-02 */
  refreshPrincipal: () => Promise<void>;
  /** Non-null when a background refresh or action failed. */
  error: Error | null;
}
