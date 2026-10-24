/**
 * Shared auth types for the admin app.
 * CLIENT-R-01..04: useAuth() shape.
 */
import type { Principal, ActiveContext, AvailableContextEntry } from '@nestself/contracts';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

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
  /** Phase 2: step-up dialog. For now a no-op placeholder. */
  stepUp: () => void;
  /** CLIENT-R-02 */
  refreshPrincipal: () => Promise<void>;
  /** Non-null when a background refresh or action failed. */
  error: Error | null;
}
