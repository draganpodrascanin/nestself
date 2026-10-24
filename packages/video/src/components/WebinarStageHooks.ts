/**
 * Hooks shared by the webinar components: translated action errors (error
 * visibility rule), change announcements for the `LiveRegion` (WBN-15) and
 * the short local time.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { webinarErrorMessage } from '../webinar/errors';
import type { WebinarActionErrorLike } from '../webinar/types';

/** Translated messages for coded action errors, plus an already translated external error. */
export function useErrorMessages(external: string | null | undefined, ...coded: Array<WebinarActionErrorLike | null | undefined>): string[] {
  const { t } = useTranslation('calls');
  const messages = [external, ...coded.map((error) => webinarErrorMessage(error, t))].filter((entry): entry is string => !!entry);
  return [...new Set(messages)];
}

/**
 * The latest announcement for a value that changes: `describe` turns a change
 * into a sentence (or null for none). Adjusts state while rendering, not in
 * an effect. Each announcement gets a new id so a repeated sentence is read again.
 */
export function useChangeAnnouncement<T>(value: T, describe: (previous: T, next: T) => string | null): { id: number; text: string } {
  const [previous, setPrevious] = useState(value);
  const [announcement, setAnnouncement] = useState({ id: 0, text: '' });
  if (!Object.is(previous, value)) {
    const text = describe(previous, value);
    setPrevious(value);
    if (text) setAnnouncement({ id: announcement.id + 1, text });
  }
  return announcement;
}

/** `14:05` in the viewer's locale. */
export function useShortTime(): (iso: string | null) => string {
  const { i18n } = useTranslation('calls');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return (iso) => {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
    } catch {
      return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso));
    }
  };
}
