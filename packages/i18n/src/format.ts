import type { Locale } from './types';

import { localeMeta } from './types';

/**
 * Format a monetary amount as currency.
 * RSD uses 2 fraction digits (ISO says 0, but the handoff shows decimals).
 */
export function formatCurrency(
  amount: number,
  currency: 'EUR' | 'RSD',
  locale: Locale,
): string {
  const intl = localeMeta[locale].intl;
  return new Intl.NumberFormat(intl, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Format a date using the Belgrade time zone. */
export function formatDate(
  date: Date | string | number,
  locale: Locale,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const intl = localeMeta[locale].intl;
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat(intl, {
    timeZone: 'Europe/Belgrade',
    dateStyle: 'long',
    ...opts,
  }).format(d);
}

/** Format a time using the Belgrade time zone. */
export function formatTime(
  date: Date | string | number,
  locale: Locale,
): string {
  const intl = localeMeta[locale].intl;
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat(intl, {
    timeZone: 'Europe/Belgrade',
    timeStyle: 'short',
  }).format(d);
}

/** Format a date and time together using the Belgrade time zone. */
export function formatDateTime(
  date: Date | string | number,
  locale: Locale,
): string {
  const intl = localeMeta[locale].intl;
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat(intl, {
    timeZone: 'Europe/Belgrade',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(d);
}
