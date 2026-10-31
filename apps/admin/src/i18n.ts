import i18next from 'i18next';
import type { Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { i18nBaseOptions, resourcesFor, localeMeta } from '@nestself/i18n';

void i18next
  .use(initReactI18next)
  .use(LanguageDetector)
  .init({
    ...i18nBaseOptions,
    resources: resourcesFor(['common', 'admin', 'auth', 'calls', 'cms', 'library']) as Resource,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'nestself-locale',
    },
  })
  .then(() => {
    const resolved = i18next.resolvedLanguage as keyof typeof localeMeta | undefined;
    if (resolved && localeMeta[resolved]) {
      document.documentElement.lang = localeMeta[resolved].htmlLang;
    }
  });

i18next.on('languageChanged', (lng) => {
  const meta = localeMeta[lng as keyof typeof localeMeta];
  if (meta) {
    document.documentElement.lang = meta.htmlLang;
  }
});

export default i18next;
