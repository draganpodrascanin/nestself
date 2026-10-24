/**
 * When an undecided follow-up approval is chased and when it lapses
 * (T-CW-1.10, D-CW-37, CALL-40, guidelines 4.5): `appointment.approval.remind`
 * after five working days, `appointment.approval.expire` after ten.
 *
 * Working days are Monday to Friday in `Europe/Belgrade`; public holidays are
 * not modelled in this epic. The deadline keeps the request's wall-clock time
 * in that zone on the target day, so a daylight saving change in between does
 * not move it by an hour. A request made on a weekend counts from Monday.
 */

/** The organization default and the only zone this epic schedules in (D-CW-38). */
export const APPROVAL_TIME_ZONE = 'Europe/Belgrade';
/** CALL-40: the approver and the alternate are reminded after this many working days. */
export const APPROVAL_REMIND_AFTER_WORKING_DAYS = 5;
/** Guidelines 4.5: an approval still undecided after this many working days expires. */
export const APPROVAL_EXPIRE_AFTER_WORKING_DAYS = 10;

const DAY_MS = 24 * 60 * 60_000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts['year']!,
    month: parts['month']!,
    day: parts['day']!,
    hour: parts['hour']!,
    minute: parts['minute']!,
    second: parts['second']!,
  };
}

/** The zone's offset from UTC at `instant`, in milliseconds (whole seconds). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * `from` moved forward by `days` working days (Monday to Friday in
 * `timeZone`), at the same local wall-clock time.
 */
export function addWorkingDays(from: Date, days: number, timeZone: string = APPROVAL_TIME_ZONE): Date {
  if (days <= 0) return new Date(from.getTime());
  const local = zonedParts(from, timeZone);
  // The local calendar date as a UTC midnight: its weekday is the local weekday.
  let date = Date.UTC(local.year, local.month - 1, local.day);
  let counted = 0;
  while (counted < days) {
    date += DAY_MS;
    const weekday = new Date(date).getUTCDay();
    if (weekday !== 0 && weekday !== 6) counted += 1;
  }
  const target = new Date(date);
  const wallClockAsUtc =
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), local.hour, local.minute, local.second) +
    (from.getTime() % 1000);
  // Two passes settle the offset on either side of a daylight saving change.
  let instant = wallClockAsUtc - offsetMs(new Date(wallClockAsUtc), timeZone);
  instant = wallClockAsUtc - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** The reminder and expiry instants of an approval requested at `requestedAt`. */
export function approvalDeadlines(requestedAt: Date): { remindAt: Date; expireAt: Date } {
  return {
    remindAt: addWorkingDays(requestedAt, APPROVAL_REMIND_AFTER_WORKING_DAYS),
    expireAt: addWorkingDays(requestedAt, APPROVAL_EXPIRE_AFTER_WORKING_DAYS),
  };
}
