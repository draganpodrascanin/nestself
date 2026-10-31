/**
 * Wall-clock times in the appointment's time zone (D-CW-37: the follow-up
 * picker works in the appointment's zone, CALL-29), converted to the UTC
 * instants the contracts carry. Intl only, no date library.
 */
import { localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

/** Milliseconds the zone is ahead of UTC at the given instant. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * `2030-01-15` + `10:30` in `Europe/Belgrade` -> `2030-01-15T09:30:00.000Z`.
 * Returns null for malformed input. A time skipped by a daylight-saving
 * switch resolves forward; a repeated time resolves to its first occurrence.
 */
export function zonedDateTimeToIso(date: string, time: string, timeZone: string): string | null {
  const d = DATE.exec(date);
  const t = TIME.exec(time);
  if (!d || !t) return null;
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  if (Number.isNaN(wall)) return null;
  try {
    const day = 24 * 60 * 60 * 1000;
    const before = offsetAt(wall - day, timeZone);
    const offsets = new Set([before, offsetAt(wall, timeZone), offsetAt(wall + day, timeZone)]);
    // Instants whose local wall time is the requested one; two on the autumn switch day.
    const valid = [...offsets].map((offset) => wall - offset).filter((instant) => offsetAt(instant, timeZone) === wall - instant);
    // Prefer the earlier instant; a skipped time keeps the offset from before the switch, which moves it forward.
    const instant = valid.length ? Math.min(...valid) : wall - before;
    return new Date(instant).toISOString();
  } catch {
    return null;
  }
}

function intlLocale(locale: string): string {
  return (localeMeta as Record<string, { intl: string } | undefined>)[locale]?.intl ?? locale;
}

/** Date and time of an instant, in the appointment's zone and the reader's locale. */
export function formatInZone(iso: string, timeZone: string, locale: Locale | string): { date: string; time: string } {
  const instant = new Date(iso);
  const intl = intlLocale(locale);
  return {
    date: new Intl.DateTimeFormat(intl, { timeZone, dateStyle: 'full' }).format(instant),
    time: new Intl.DateTimeFormat(intl, { timeZone, timeStyle: 'short' }).format(instant),
  };
}
