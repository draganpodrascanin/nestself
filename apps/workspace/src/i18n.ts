import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { i18nBaseOptions, resourcesFor, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

import type { Resource } from 'i18next';

const resources = resourcesFor(['common', 'workspace', 'auth', 'library']) as Resource;

function syncHtmlLang(lng: string): void {
  const meta = localeMeta[lng as Locale];
  if (meta) {
    document.documentElement.lang = meta.htmlLang;
  }
}

void i18next
  .use(initReactI18next)
  .use(LanguageDetector)
  .init({
    ...i18nBaseOptions,
    resources,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'nestself-locale',
    },
  })
  .then(() => {
    syncHtmlLang(i18next.resolvedLanguage ?? i18next.language);
  });

i18next.on('languageChanged', syncHtmlLang);

export default i18next;
