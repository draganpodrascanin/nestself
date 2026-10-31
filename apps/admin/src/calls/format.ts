/**
 * Appointment dates and times in the appointment's own time zone (CALL-18)
 * and the reader's locale, with Intl only.
 */
import { useTranslation } from 'react-i18next';
import { localeMeta } from '@nestself/i18n';
import { CALL_ROOM_CLOSE_AFTER_MINUTES, SupportAreaSchema } from '@nestself/contracts';
import type { Appointment, AppointmentStatus, SupportArea } from '@nestself/contracts';
import type { BadgeTone } from '@nestself/ui';

function intlLocale(language: string): string {
  return (localeMeta as Record<string, { intl: string } | undefined>)[language]?.intl ?? language;
}

/** Formatters bound to the current language. */
export function useZonedFormat() {
  const { i18n } = useTranslation();
  const intl = intlLocale(i18n.resolvedLanguage ?? i18n.language);
  return {
    date: (instant: string | Date, timeZone: string) => new Intl.DateTimeFormat(intl, { timeZone, dateStyle: 'full' }).format(new Date(instant)),
    short: (instant: string | Date, timeZone: string) =>
      new Intl.DateTimeFormat(intl, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant)),
    time: (instant: string | Date, timeZone: string) => new Intl.DateTimeFormat(intl, { timeZone, timeStyle: 'short' }).format(new Date(instant)),
  };
}

export function supportAreaOf(category: string): SupportArea | null {
  const parsed = SupportAreaSchema.safeParse(category);
  return parsed.success ? parsed.data : null;
}

export function useCategoryLabel() {
  const { t } = useTranslation(['calls', 'common']);
  return (category: string) => {
    const area = supportAreaOf(category);
    return area ? t(`common:area.${area}`) : t('calls:appointments.categoryOther');
  };
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

export type OutcomeColumn = 'completed' | 'no_show' | 'canceled' | 'toRecord' | 'notYet';

/**
 * The outcome as the appointment's status records it (CALL-23 criterion 6:
 * completed, no_show or canceled). A confirmed appointment whose time has
 * passed still needs its outcome.
 */
export function outcomeColumn(appointment: Pick<Appointment, 'status' | 'startsAt'>, now: number): OutcomeColumn {
  if (appointment.status === 'completed' || appointment.status === 'no_show' || appointment.status === 'canceled') return appointment.status;
  if (appointment.status === 'confirmed' && Date.parse(appointment.startsAt) <= now) return 'toRecord';
  return 'notYet';
}

/** When the room closes and a rejoin stops: `endsAt + CALL_ROOM_CLOSE_AFTER_MINUTES` (D-CW-09). */
export function roomClosesAt(appointment: { endsAt: string }): Date {
  return new Date(Date.parse(appointment.endsAt) + CALL_ROOM_CLOSE_AFTER_MINUTES * 60_000);
}
