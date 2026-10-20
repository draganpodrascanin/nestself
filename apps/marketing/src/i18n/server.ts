import { cache } from 'react';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { i18nBaseOptions, resources } from '@nestself/i18n';
import type { Locale, Namespace } from '@nestself/i18n';

export const getServerT = cache(
  async (locale: Locale, ns: Namespace[] = ['common', 'marketing']) => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({
      ...i18nBaseOptions,
      lng: locale,
      resources,
      ns,
    });
    return { t: i18n.getFixedT(locale, ns), i18n };
  },
);
