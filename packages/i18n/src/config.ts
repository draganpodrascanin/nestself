import type { InitOptions } from 'i18next';

import { defaultLocale, locales, namespaces } from './types';

export const i18nBaseOptions: InitOptions = {
  supportedLngs: [...locales],
  fallbackLng: {
    'sr-Cyrl': ['sr-Latn', 'en'],
    'sr-Latn': ['en'],
    hu: ['en'],
    en: ['sr-Latn'],
    default: ['sr-Latn'],
  },
  load: 'currentOnly',
  defaultNS: 'common',
  ns: [...namespaces],
  interpolation: { escapeValue: false },
  returnNull: false,
};

export const defaultLng = defaultLocale;
