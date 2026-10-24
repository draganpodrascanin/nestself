/**
 * Shared API error handler for the workspace app (section 6.1.5).
 *
 * 401 -> clear principal, cancel queries, navigate to /sign-in.
 * 403 step_up_required -> open the step-up dialog (`stepUp()`); wrap the call in
 *   `withStepUp` to retry it after verification.
 * 403 org_context_expired -> switch to personal context and toast.
 * 429 -> caller shows lockout copy from `details.retryAfter`.
 */
import type { NavigateFn } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@nestself/api-client';
import type { ActiveContext } from '@nestself/contracts';

interface ErrorHandlerDeps {
  navigate: NavigateFn;
  queryClient: QueryClient;
  refreshPrincipal: () => Promise<void>;
  switchContext: (ctx: ActiveContext) => Promise<void>;
  stepUp: () => Promise<boolean>;
  showToast?: (message: string) => void;
}

export function handleApiError(error: unknown, deps: ErrorHandlerDeps): void {
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
    void deps.switchContext({ kind: 'personal' });
    deps.showToast?.('Your organisation session has expired. Switched to personal context.');
    return;
  }

  // 429: the caller is responsible for showing lockout copy.
  // Other 403: the caller can show a StatusBlock state="permission".
}
