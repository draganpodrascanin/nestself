import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { Session } from '@nestself/contracts';
import {
  ThemeProvider,
  ThemeStudio,
  SkipLink,
  AnnouncerProvider,
  ToastProvider,
  StatusBlock,
  Badge,
} from '@nestself/ui';
import { SampleDataBanner } from '@nestself/ui';
import { isSampleMode } from '@nestself/sample-data';
import { healthQueryOptions } from '@nestself/api-client';
import i18n from '../i18n';
import { SessionProvider } from '../session';
import { api } from '../api';
import '../app.css';

export interface RouterContext {
  queryClient: QueryClient;
  session: Session;
}

function ApiStatus() {
  const { t } = useTranslation('admin');
  const { data } = useQuery({
    ...healthQueryOptions(api),
    retry: false,
  });

  const connected = data?.status === 'ok';

  return connected ? (
    <span className="flex items-center gap-1.5 type-metadata text-success">
      <span className="inline-block w-2 h-2 rounded-full bg-success" aria-hidden />
      {t('api.connected')}
    </span>
  ) : (
    <Badge tone="warning">{t('api.notConnected')}</Badge>
  );
}

export { ApiStatus };

function RootComponent() {
  const { t } = useTranslation('common');
  const isDev = import.meta.env.DEV;
  const sampleMode = isDev || isSampleMode(import.meta.env as unknown as Record<string, string | undefined>);
  const ctx = Route.useRouteContext();

  return (
    <QueryClientProvider client={ctx.queryClient}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ToastProvider labels={{ dismiss: t('nav.close') }}>
            <AnnouncerProvider>
              <SessionProvider>
                {sampleMode ? <SampleDataBanner message={t('sample.banner')} /> : null}
                <SkipLink>{t('nav.skipToContent')}</SkipLink>
                <Outlet />
                {isDev ? (
                  <ThemeStudio
                    enabled
                    labels={{
                      palette: t('theme.palette'),
                      mode: t('theme.mode'),
                      font: t('theme.font'),
                      heading: t('theme.designControls'),
                    }}
                  />
                ) : null}
              </SessionProvider>
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
    <div className="flex items-center justify-center min-h-screen p-6">
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
