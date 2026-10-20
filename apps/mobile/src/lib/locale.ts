import { negotiateLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

/**
 * Resolve the best locale from a list of device language tags.
 * Wraps negotiateLocale for use with expo-localization getLocales().
 */
export function resolveDeviceLocale(tags: readonly string[]): Locale {
  return negotiateLocale(tags);
}
