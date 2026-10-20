'use client';

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { i18nBaseOptions, resources } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

function createI18nInstance(locale: Locale) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({
    ...i18nBaseOptions,
    lng: locale,
    resources,
    ns: ['common', 'marketing'],
  });
  return i18n;
}

export interface I18nProviderProps {
  locale: Locale;
  children: ReactNode;
}

export function I18nProvider({ locale, children }: I18nProviderProps) {
  const i18n = useMemo(() => createI18nInstance(locale), [locale]);

  return (
    <I18nextProvider i18n={i18n}>
      {children}
    </I18nextProvider>
  );
}
