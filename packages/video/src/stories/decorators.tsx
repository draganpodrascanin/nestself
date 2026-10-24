/**
 * Storybook decorators for the video components: a `calls` i18n instance
 * (English by default; a story sets `parameters.locale` for another locale).
 * Stories never join a real meeting: Chime-backed components get a
 * `FakeCallSessionController`.
 */
import type { Decorator } from '@storybook/react-vite';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { AnnouncerProvider } from '@nestself/ui';
import { resourcesFor } from '@nestself/i18n';

const storyI18n = i18next.createInstance();
void storyI18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: { 'sr-Cyrl': ['sr-Latn', 'en'], default: ['en'] },
  ns: ['calls'],
  defaultNS: 'calls',
  resources: resourcesFor(['calls']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

export const withCallsI18n: Decorator = (Story, context) => {
  const locale = (context.parameters['locale'] as string | undefined) ?? 'en';
  if (storyI18n.language !== locale) void storyI18n.changeLanguage(locale);
  return (
    <I18nextProvider i18n={storyI18n}>
      <AnnouncerProvider>
        <Story />
      </AnnouncerProvider>
    </I18nextProvider>
  );
};
