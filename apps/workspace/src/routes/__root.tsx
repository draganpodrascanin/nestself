import { createRootRouteWithContext, Outlet, useRouter } from '@tanstack/react-router';
import { I18nextProvider, useTranslation } from 'react-i18next';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  ThemeProvider,
  ThemeStudio,
  ToastProvider,
  AnnouncerProvider,
  SkipLink,
  SampleDataBanner,
  StatusBlock,
} from '@nestself/ui';
import i18n from '../i18n';
import { isSampleDataMode } from '../data-source';
import { useAuth, SampleAuthProvider, AuthProvider } from '../auth';
import type { RouterAuth } from '../auth';
import { RoleSwitcher } from '../components/RoleSwitcher';
import { api } from '../api';

interface RouterContext {
  queryClient: QueryClient;
  auth: RouterAuth;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <StatusBlock
        state="permission"
        title={t('state.permission.title')}
        body={t('state.permission.body')}
      />
    </div>
  );
}

/** Wraps children in the correct auth provider based on data-source mode. */
function AuthWrapper({ children }: { children: ReactNode }) {
  if (isSampleDataMode) {
    return <SampleAuthProvider>{children}</SampleAuthProvider>;
  }
  return <AuthProvider client={api}>{children}</AuthProvider>;
}

const sameActions = (a: readonly string[], b: readonly string[]) =>
  a === b || (a.length === b.length && a.every((action, i) => action === b[i]));

/**
 * Syncs auth state into the router context so `beforeLoad` gates
 * can read `context.auth.principal` and `context.auth.effectiveActions`.
 */
function AuthRouterSync({ children }: { children: ReactNode }) {
  const { principal, effectiveActions, status } = useAuth();
  const router = useRouter();
  // A failed `/auth/me` (`error`) is no result: with an empty context the
  // guards would read it as "signed out" and redirect to /sign-in instead of
  // asking again (route-auth.ts) and showing the account error screen.
  const settled = status === 'authenticated' || status === 'unauthenticated';

  useEffect(() => {
    const currentAuth = router.options.context.auth;
    // Compared by content: the provider's empty list is never the router's, and
    // an invalidation that changes nothing would re-run the guards (and show the
    // account error screen afresh) for no reason.
    if (
      currentAuth.principal !== principal ||
      !sameActions(currentAuth.effectiveActions, effectiveActions) ||
      currentAuth.settled !== settled
    ) {
      router.update({
        context: {
          ...router.options.context,
          // Keep `ensure`: guards still use it while the provider is loading.
          auth: { ...currentAuth, principal, effectiveActions, settled },
        },
      });
      void router.invalidate();
    }
  }, [principal, effectiveActions, settled, router]);

  return <>{children}</>;
}

function RootComponent() {
  const { t } = useTranslation('common');
  const isDev = import.meta.env.DEV;
  const isWebdriver = typeof navigator !== 'undefined' && navigator.webdriver;

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ToastProvider labels={{ dismiss: t('nav.close') }}>
          <AnnouncerProvider>
            <AuthWrapper>
              <AuthRouterSync>
                <SkipLink>{t('nav.skipToContent')}</SkipLink>
                {isSampleDataMode ? <SampleDataBanner message={t('sample.banner')} /> : null}
                <Outlet />
                {isDev && !isWebdriver ? (
                  <>
                    <ThemeStudio
                      enabled
                      labels={{
                        palette: t('theme.palette'),
                        mode: t('theme.mode'),
                        font: t('theme.font'),
                        heading: t('theme.designControls'),
                      }}
                    />
                    {isSampleDataMode ? (
                      <details className="fixed bottom-20 right-4 z-[var(--z-sticky)] rounded-control bg-surface p-4 shadow-menu border border-border-control">
                        <summary className="cursor-pointer type-label">Sample role</summary>
                        <div className="mt-3">
                          <RoleSwitcher />
                        </div>
                      </details>
                    ) : null}
                  </>
                ) : null}
              </AuthRouterSync>
            </AuthWrapper>
          </AnnouncerProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
