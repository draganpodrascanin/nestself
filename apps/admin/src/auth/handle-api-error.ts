/**
 * Shared API error handler for the admin app (6.1.5).
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
  /** i18n translation function. */
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
    // Phase 2: step-up dialog. For now, redirect to sign-in.
    void navigate({
      to: '/sign-in',
      search: { return: window.location.pathname },
    });
    return;
  }

  if (error.status === 403 && error.code === 'org_context_expired') {
    void deps.switchContext({ kind: 'personal' });
    const message = deps.t
      ? deps.t('contextSwitcher.error.org_context_expired')
      : 'Your organisation session has expired.';
    deps.showToast?.(message);
    return;
  }

  // 429 — lockout. The caller may show lockout copy using details.retryAfter.
}
