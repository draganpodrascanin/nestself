/**
 * Per-locale wording helpers for the questionnaire editor and preview. The
 * four catalog locales are the four wording locales: a version must carry
 * all of them before it can be saved.
 */
import { localeMeta, locales } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

export const WORDING_LOCALES: readonly Locale[] = locales;

/** The text in the locale, falling back to English, then to any filled locale. */
export function localized(text: Partial<Record<string, string>>, locale: Locale): string {
  return text[locale] ?? text['en'] ?? Object.values(text).find((v): v is string => !!v) ?? '';
}

/** The locale's own name (for example "Srpski (latinica)"). */
export function localeLabel(locale: Locale): string {
  return localeMeta[locale].nativeName;
}
