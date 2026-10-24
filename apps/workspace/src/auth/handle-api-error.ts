/**
 * Shared API error handler for the workspace app (section 6.1.5).
 *
 * 401 -> clear principal, cancel queries, navigate to /sign-in.
 * 403 step_up_required -> redirect to /sign-in (phase 2: step-up dialog).
 * 403 org_context_expired -> switch to personal context and toast.
 * 429 -> caller shows lockout copy from `details.retryAfter`.
 *
 * Wired through QueryClient cache onError so it fires on every failed
 * query and mutation (ruling 6, T-C1.02).
 */
import type { NavigateFn } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@nestself/api-client';
import type { ActiveContext } from '@nestself/contracts';

export interface ErrorHandlerDeps {
  navigate: NavigateFn;
  queryClient: QueryClient;
  refreshPrincipal: () => Promise<void>;
  switchContext: (ctx: ActiveContext) => Promise<void>;
  showToast?: (message: string) => void;
  /** i18n translation function scoped to the workspace namespace. */
  t?: (key: string) => string;
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
    // Phase 2: show a step-up dialog. For now redirect to sign-in.
    void navigate({
      to: '/sign-in',
      search: { return: window.location.pathname },
    });
    return;
  }

  if (error.status === 403 && error.code === 'org_context_expired') {
    void deps.switchContext({ kind: 'personal' });
    // Translated copy from i18n (ruling 6); falls back to English for safety.
    const message = deps.t
      ? deps.t('contextSwitcher.error.org_context_expired')
      : 'Your organisation session has expired.';
    deps.showToast?.(message);
    return;
  }

  // 429: the caller is responsible for showing lockout copy.
  // Other 403: the caller can show a StatusBlock state="permission".
}
