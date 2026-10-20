import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { I18nextProvider, useTranslation } from 'react-i18next';
import type { QueryClient } from '@tanstack/react-query';
import {
  ThemeProvider,
  ThemeStudio,
  ToastProvider,
  AnnouncerProvider,
  SkipLink,
  SampleDataBanner,
  StatusBlock,
} from '@nestself/ui';
import type { Session } from '@nestself/contracts';
import i18n from '../i18n';
import { SessionProvider } from '../session';
import { RoleSwitcher } from '../components/RoleSwitcher';

interface RouterContext {
  queryClient: QueryClient;
  session: Session;
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

function RootComponent() {
  const { t } = useTranslation('common');
  const isDev = import.meta.env.DEV;
  const isWebdriver = typeof navigator !== 'undefined' && navigator.webdriver;

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <ToastProvider labels={{ dismiss: t('nav.close') }}>
          <AnnouncerProvider>
            <SessionProvider>
              <SkipLink>{t('nav.skipToContent')}</SkipLink>
              {isDev ? <SampleDataBanner message={t('sample.banner')} /> : null}
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
                  {/* Sample role switcher — positioned alongside ThemeStudio */}
                  <details className="fixed bottom-20 right-4 z-[var(--z-sticky)] rounded-control bg-surface p-4 shadow-menu border border-border-control">
                    <summary className="cursor-pointer type-label">Sample role</summary>
                    <div className="mt-3">
                      <RoleSwitcher />
                    </div>
                  </details>
                </>
              ) : null}
            </SessionProvider>
          </AnnouncerProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
