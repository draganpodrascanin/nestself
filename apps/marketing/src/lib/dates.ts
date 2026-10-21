import { formatDate, formatTime, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

/**
 * Format an article's published date for card and detail display.
 * Wraps the shared `formatDate` (long date style, Europe/Belgrade TZ).
 */
export function formatArticleDate(iso: string, locale: Locale): string {
  return formatDate(iso, locale);
}

/**
 * Format a webinar's start date-time for card and detail display.
 * Output: "12 November 2026, 18:00 CET" (English) and the locale's
 * natural equivalent. Time zone is always Europe/Belgrade (CET/CEST).
 */
export function formatWebinarDateTime(iso: string, locale: Locale): string {
  const datePart = formatDate(iso, locale);
  const timePart = formatTime(iso, locale);
  const tz = getTimezoneAbbr(iso, locale);
  return `${datePart}, ${timePart} ${tz}`;
}

/** Extract the short timezone name (CET / CEST) for a given instant. */
function getTimezoneAbbr(iso: string, locale: Locale): string {
  const d = new Date(iso);
  const intl = localeMeta[locale].intl;
  const parts = new Intl.DateTimeFormat(intl, {
    timeZone: 'Europe/Belgrade',
    timeZoneName: 'short',
  }).formatToParts(d);
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  return tzPart?.value ?? 'CET';
}
