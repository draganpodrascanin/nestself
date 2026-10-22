/**
 * Shared API error handler for the admin app (6.1.5).
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
    // Phase 2: step-up dialog. For now, redirect to sign-in.
    void navigate({
      to: '/sign-in',
      search: { return: window.location.pathname },
    });
    return;
  }

  if (error.status === 403 && error.code === 'org_context_expired') {
    void deps.switchContext({ kind: 'personal' });
    deps.showToast?.(
      'Your organisation session has expired. Switched to personal context.',
    );
    return;
  }

  // 429 — lockout. The caller may show lockout copy using details.retryAfter.
}
