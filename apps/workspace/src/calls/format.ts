/**
 * Appointment dates and times in the appointment's own time zone (CALL-02,
 * CALL-29) and the reader's locale, with Intl only.
 */
import { useTranslation } from 'react-i18next';
import { localeMeta } from '@nestself/i18n';
import { CALL_ROOM_CLOSE_AFTER_MINUTES, SupportAreaSchema } from '@nestself/contracts';
import type { AppointmentStatus, SupportArea } from '@nestself/contracts';
import type { BadgeTone } from '@nestself/ui';

function intlLocale(language: string): string {
  return (localeMeta as Record<string, { intl: string } | undefined>)[language]?.intl ?? language;
}

export function formatZonedDate(instant: string | Date, timeZone: string, language: string): string {
  return new Intl.DateTimeFormat(intlLocale(language), { timeZone, dateStyle: 'full' }).format(new Date(instant));
}

export function formatZonedTime(instant: string | Date, timeZone: string, language: string): string {
  return new Intl.DateTimeFormat(intlLocale(language), { timeZone, timeStyle: 'short' }).format(new Date(instant));
}

/** Formatters bound to the current language. */
export function useZonedFormat() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return {
    date: (instant: string | Date, timeZone: string) => formatZonedDate(instant, timeZone, language),
    time: (instant: string | Date, timeZone: string) => formatZonedTime(instant, timeZone, language),
  };
}

/** The service category as a support area, or null for a category without its own label. */
export function supportAreaOf(category: string): SupportArea | null {
  const parsed = SupportAreaSchema.safeParse(category);
  return parsed.success ? parsed.data : null;
}

export const STATUS_TONE: Readonly<Record<AppointmentStatus, BadgeTone>> = {
  proposed: 'info',
  awaiting_approval: 'warning',
  confirmed: 'success',
  completed: 'neutral',
  canceled: 'neutral',
  declined: 'neutral',
  no_show: 'warning',
};

/** Scheduled length in whole minutes. */
export function durationMinutes(appointment: { startsAt: string; endsAt: string }): number {
  return Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000);
}

/** When the room closes and a rejoin stops: `endsAt + CALL_ROOM_CLOSE_AFTER_MINUTES` (D-CW-09). */
export function roomClosesAt(appointment: { endsAt: string }): Date {
  return new Date(Date.parse(appointment.endsAt) + CALL_ROOM_CLOSE_AFTER_MINUTES * 60_000);
}
