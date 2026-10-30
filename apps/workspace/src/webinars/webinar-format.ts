/**
 * Webinar text and time helpers shared by the list, detail and live routes:
 * the title in the reader's language with a fallback, the schedule in the
 * occurrence's time zone, a ticking clock and the attendee's join window.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CALL_JOIN_WINDOW_BEFORE_MINUTES, CALL_ROOM_CLOSE_AFTER_MINUTES } from '@nestself/contracts';
import type { WebinarLocalizedText } from '@nestself/contracts';
import { useZonedFormat } from '../calls/format';

const MINUTE_MS = 60_000;

const FALLBACK_ORDER = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const;

/** The text in `language`, else its Serbian sibling script, else the first locale present. */
export function localizedText(text: WebinarLocalizedText | null | undefined, language: string): string {
  if (!text) return '';
  const own = text[language as keyof WebinarLocalizedText];
  if (own) return own;
  const sibling = language === 'sr-Cyrl' ? text['sr-Latn'] : language === 'sr-Latn' ? text['sr-Cyrl'] : undefined;
  if (sibling) return sibling;
  for (const locale of FALLBACK_ORDER) {
    const value = text[locale];
    if (value) return value;
  }
  return '';
}

export function useLocalized() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return (text: WebinarLocalizedText | null | undefined) => localizedText(text, language);
}

/** "Wednesday, 25 November 2026, 17:00 (Europe/Belgrade)". */
export function useWebinarWhen() {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  return (webinar: { startsAt: string; timeZone: string }) =>
    t('webinar.when', {
      date: format.date(webinar.startsAt, webinar.timeZone),
      time: format.time(webinar.startsAt, webinar.timeZone),
      zone: webinar.timeZone,
    });
}

/** Ticks every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** The attendee's room: from 15 minutes before the start to 15 minutes after the end (WBN-06). */
export function attendeeJoinWindow(webinar: { startsAt: string; endsAt: string }) {
  return {
    opensAt: new Date(Date.parse(webinar.startsAt) - CALL_JOIN_WINDOW_BEFORE_MINUTES * MINUTE_MS),
    closesAt: new Date(Date.parse(webinar.endsAt) + CALL_ROOM_CLOSE_AFTER_MINUTES * MINUTE_MS),
  };
}
