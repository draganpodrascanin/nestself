import { createRootRouteWithContext, Outlet, useRouter } from '@tanstack/react-router';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  ThemeProvider,
  ThemeStudio,
  SkipLink,
  AnnouncerProvider,
  ToastProvider,
  StatusBlock,
  Badge,
  useToast,
} from '@nestself/ui';
import { SampleDataBanner } from '@nestself/ui';
import { healthQueryOptions } from '@nestself/api-client';
import i18n from '../i18n';
import { isSampleDataMode } from '../data-source';
import { useAuth, AuthProvider, SampleAuthProvider, SAMPLE_ROLE_ORDER, useSampleAuth } from '../auth';
import type { AuthSnapshot } from '../auth';
import { api } from '../api';
import { globalErrorDepsRef } from '../main';
import '../app.css';

interface RouterContext {
  queryClient: QueryClient;
  auth: AuthSnapshot;
}

function ApiStatus() {
  const { t } = useTranslation('admin');
  const { data } = useQuery({
    ...healthQueryOptions(api),
    retry: false,
    // Only probe when an API URL is configured; sample mode must not depend on a backend.
    enabled: Boolean(import.meta.env.VITE_API_URL),
  });

  const connected = data?.status === 'ok';

  return connected ? (
    <span className="gap-1.5 flex items-center type-metadata text-success">
      <span className="w-2 h-2 inline-block rounded-full bg-success" aria-hidden />
      {t('api.connected')}
    </span>
  ) : (
    <Badge tone="warning">{t('api.notConnected')}</Badge>
  );
}

export { ApiStatus };

function AdminRoleSwitcher() {
  const { t } = useTranslation('admin');
  const { currentRole, setRole } = useSampleAuth();

  return (
    <label className="gap-1 flex flex-col type-metadata">
      {t('dev.sampleRole')}
      <select
        value={currentRole}
        onChange={(e) => setRole(e.target.value)}
        className="px-2 py-1 rounded-control border border-border-control bg-surface"
      >
        {SAMPLE_ROLE_ORDER.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </label>
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
  const { principal, effectiveActions, availableContexts, switchContext, stepUp, refreshPrincipal } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation('admin');

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
      stepUp,
      showToast: (message: string) => toast.add({ title: message, tone: 'danger' }),
      t,
    };
    return () => { globalErrorDepsRef.current = null; };
  }, [router.navigate, queryClient, refreshPrincipal, switchContext, stepUp, toast, t]);

  return <>{children}</>;
}

function RootComponent() {
  const { t } = useTranslation(['common', 'admin']);
  const isDev = import.meta.env.DEV;
  const isWebdriver = typeof navigator !== 'undefined' && navigator.webdriver;
  const ctx = Route.useRouteContext();

  return (
    <QueryClientProvider client={ctx.queryClient}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ToastProvider labels={{ dismiss: t('nav.close') }}>
            <AnnouncerProvider>
              <AuthWrapper>
                <AuthRouterSync>
                  {isSampleDataMode ? (
                    <SampleDataBanner message={t('sample.banner')} />
                  ) : null}
                  <SkipLink>{t('nav.skipToContent')}</SkipLink>
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
                        <details className="bottom-20 right-4 p-4 fixed z-[var(--z-sticky)] rounded-control border border-border-control bg-surface shadow-menu">
                          <summary className="cursor-pointer type-label">
                            {t('admin:dev.sampleRole')}
                          </summary>
                          <div className="mt-3">
                            <AdminRoleSwitcher />
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
    </QueryClientProvider>
  );
}

function NotFoundComponent() {
  const { t } = useTranslation('common');

  return (
    <div className="p-6 flex min-h-screen items-center justify-center">
      <StatusBlock
        state="permission"
        title={t('state.permission.title')}
        body={t('state.permission.body')}
      />
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});
