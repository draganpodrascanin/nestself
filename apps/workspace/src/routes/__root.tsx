import { createRootRouteWithContext, Outlet, useRouter } from '@tanstack/react-router';
import { I18nextProvider, useTranslation } from 'react-i18next';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
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
  useToast,
} from '@nestself/ui';
import i18n from '../i18n';
import { isSampleDataMode } from '../data-source';
import { useAuth, SampleAuthProvider, AuthProvider } from '../auth';
import type { AuthSnapshot } from '../auth';
import { RoleSwitcher } from '../components/RoleSwitcher';
import { api } from '../api';
import { globalErrorDepsRef } from '../main';

interface RouterContext {
  queryClient: QueryClient;
  auth: AuthSnapshot;
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

/**
 * Syncs auth state into the router context so `beforeLoad` gates
 * can read `context.auth.principal` and `context.auth.effectiveActions`.
 * Also wires the global error handler deps for QueryCache (ruling 6).
 */
function AuthRouterSync({ children }: { children: ReactNode }) {
  const { principal, effectiveActions, availableContexts, switchContext, refreshPrincipal } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation('workspace');

  useEffect(() => {
    const currentAuth = router.options.context.auth;
    if (
      currentAuth.principal !== principal ||
      currentAuth.effectiveActions !== effectiveActions ||
      currentAuth.availableContexts !== availableContexts
    ) {
      router.update({
        context: {
          ...router.options.context,
          auth: { principal, effectiveActions, availableContexts },
        },
      });
      void router.invalidate();
    }
  }, [principal, effectiveActions, availableContexts, router]);

  // Keep the global error handler deps up to date (ruling 6, T-C1.02).
  useEffect(() => {
    globalErrorDepsRef.current = {
      navigate: router.navigate,
      queryClient,
      refreshPrincipal,
      switchContext,
      showToast: (message: string) => toast.add({ title: message, tone: 'danger' }),
      t,
    };
    return () => { globalErrorDepsRef.current = null; };
  }, [router.navigate, queryClient, refreshPrincipal, switchContext, toast, t]);

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
