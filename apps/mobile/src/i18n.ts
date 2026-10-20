import i18next from 'i18next';
import type { Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { i18nBaseOptions, resourcesFor } from '@nestself/i18n';
import { resolveDeviceLocale } from '@/lib/locale';
import { getItem, setItem } from '@/lib/storage';

const LOCALE_STORAGE_KEY = 'nestself-locale';

const deviceTags = getLocales().map((l) => l.languageTag);
const deviceLocale = resolveDeviceLocale(deviceTags);

const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  ...i18nBaseOptions,
  resources: resourcesFor(['common', 'mobile']) as Resource,
  lng: deviceLocale,
  react: { useSuspense: false },
});

/**
 * Load a previously persisted locale override from AsyncStorage.
 * Call this once during app initialisation.
 */
export async function loadPersistedLocale(): Promise<void> {
  const stored = await getItem(LOCALE_STORAGE_KEY);
  if (stored && stored !== i18n.language) {
    await i18n.changeLanguage(stored);
  }
}

/**
 * Change the app locale and persist it.
 */
export async function changeLocale(locale: string): Promise<void> {
  await i18n.changeLanguage(locale);
  await setItem(LOCALE_STORAGE_KEY, locale);
}

export default i18n;
