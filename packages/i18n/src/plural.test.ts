import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import { resources } from './resources';

describe('i18next plural integration', () => {
  afterEach(async () => {
    // Reset i18next between tests to avoid state leakage
    if (i18next.isInitialized) {
      await i18next.changeLanguage('sr-Latn');
    }
  });

  it('uses Serbian Latin plurals correctly', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'sr-Latn',
      resources: {
        'sr-Latn': resources['sr-Latn'],
      },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });

    // count=1 -> _one: "1 učesnik"
    expect(instance.t('count.participant', { count: 1 })).toMatch(/učesnik$/);

    // count=3 -> _few: "3 učesnika" (Serbian few is 2-4)
    expect(instance.t('count.participant', { count: 3 })).toMatch(/učesnika$/);

    // count=25 -> _other: "25 učesnika"
    expect(instance.t('count.participant', { count: 25 })).toMatch(/učesnika$/);
  });

  it('uses Serbian Cyrillic plurals correctly', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'sr-Cyrl',
      resources: {
        'sr-Cyrl': resources['sr-Cyrl'],
      },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });

    // Cyrillic output should contain "учесник" (one) or "учесника" (few/other)
    expect(instance.t('count.participant', { count: 1 })).toMatch(/учесник$/);
    expect(instance.t('count.participant', { count: 3 })).toMatch(/учесника$/);
  });

  it('falls back to sr-Latn when a sr-Cyrl key is deleted', async () => {
    // Clone resources and delete a key from sr-Cyrl
    const clonedResources = JSON.parse(JSON.stringify(resources));
    delete clonedResources['sr-Cyrl'].common.brand;

    const instance = i18next.createInstance();
    await instance.init({
      lng: 'sr-Cyrl',
      resources: clonedResources,
      fallbackLng: { 'sr-Cyrl': ['sr-Latn', 'en'], default: ['en'] },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });

    // Should fall back to sr-Latn's brand.name
    expect(instance.t('brand.name')).toBe('NestSelf');
  });
});
