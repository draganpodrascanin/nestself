/**
 * Shared auth types for the workspace app.
 * CLIENT-R-01..04: useAuth() shape.
 */
import type { Principal, ActiveContext } from '@nestself/contracts';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthSnapshot {
  principal: Principal | null;
  effectiveActions: readonly string[];
}

export interface AuthContextValue extends AuthSnapshot {
  /** CLIENT-R-01: current auth status. */
  status: AuthStatus;
  /** CLIENT-R-03: sign out, clear session. */
  signOut: () => Promise<void>;
  /** CLIENT-R-04: switch the active context (org / personal / expert / operations). */
  switchContext: (context: ActiveContext) => Promise<void>;
  /** CLIENT-R-04: request step-up authentication. Phase 2: shows dialog; for now a no-op. */
  stepUp: () => void;
  /** CLIENT-R-02: re-fetch the principal from the server. */
  refreshPrincipal: () => Promise<void>;
  /** Non-null when a background refresh or action failed. */
  error: Error | null;
}
