/** Test helpers: an English `calls` i18n instance and a render wrapper. */
import { render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { resourcesFor } from '@nestself/i18n';

export const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['calls'],
  defaultNS: 'calls',
  resources: resourcesFor(['calls']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
});

/** `t` for the `calls` namespace in English, to assert on real copy. */
export const t = testI18n.getFixedT('en', 'calls') as (key: string, options?: Record<string, unknown>) => string;

export function renderWithI18n(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => <I18nextProvider i18n={testI18n}>{children}</I18nextProvider>,
    ...options,
  });
}
