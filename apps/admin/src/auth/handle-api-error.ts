/**
 * Shared API error handler for the admin app (6.1.5).
 *
 * Wired through QueryClient cache onError so it fires on every failed
 * query and mutation (ruling 6, T-C1.02).
 *
 * 403 step_up_required -> open the step-up dialog (`stepUp()`); wrap the call in
 *   `withStepUp` to retry it after verification. `StepUpCancelledError` (the
 *   user cancelled) is ignored.
 * 403 org_context_expired -> switch to personal context and toast.
 *   At most one recovery switch runs at a time (module-level in-flight promise,
 *   I4).  Failed recovery shows `contextSwitcher.error.unknown`.
 */
import type { NavigateFn } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@nestself/api-client';
import type { ActiveContext } from '@nestself/contracts';
import { StepUpCancelledError } from './with-step-up';

export interface ErrorHandlerDeps {
  navigate: NavigateFn;
  queryClient: QueryClient;
  refreshPrincipal: () => Promise<void>;
  switchContext: (ctx: ActiveContext) => Promise<void>;
  stepUp: () => Promise<boolean>;
  showToast: (message: string) => void;
  /** i18n translation function. Required (I4). */
  t: (key: string) => string;
}

/** Module-level in-flight promise prevents concurrent recovery switches (I4). */
let recoveryInFlight: Promise<void> | null = null;

export function handleApiError(error: unknown, deps: ErrorHandlerDeps): void {
  // The user cancelled the step-up dialog: already handled, do not re-prompt.
  if (error instanceof StepUpCancelledError) return;
  if (!(error instanceof ApiError)) return;

  const { navigate, queryClient } = deps;

  if (error.status === 401) {
    queryClient.cancelQueries();
    void navigate({
      to: '/sign-in',
      search: { return: window.location.pathname },
    });
    return;
  }

  if (error.status === 403 && error.code === 'step_up_required') {
    void deps.stepUp();
    return;
  }

  if (error.status === 403 && error.code === 'org_context_expired') {
    // At most one recovery at a time; subsequent errors are silently coalesced.
    if (recoveryInFlight) return;
    recoveryInFlight = deps.switchContext({ kind: 'personal' })
      .then(() => {
        deps.showToast(deps.t('contextSwitcher.error.org_context_expired'));
      })
      .catch(() => {
        deps.showToast(deps.t('contextSwitcher.error.unknown'));
      })
      .finally(() => {
        recoveryInFlight = null;
      });
    return;
  }

  // 429 — lockout. The caller may show lockout copy using details.retryAfter.
}
