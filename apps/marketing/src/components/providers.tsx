'use client';

import type { ReactNode } from 'react';
import { AnnouncerProvider, ThemeProvider } from '@nestself/ui';
import { I18nProvider } from '@/i18n/client';
import type { Locale } from '@nestself/i18n';

export function Providers({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <I18nProvider locale={locale}>
      <AnnouncerProvider>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </AnnouncerProvider>
    </I18nProvider>
  );
}
