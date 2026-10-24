/**
 * In-house RFC 5545 generator for the calendar files attached to session and
 * webinar emails (D-CW-26, D-CW-32: no dependency, `Intl` for time zones).
 *
 * The event is always neutral and private: a neutral `SUMMARY` chosen by the
 * caller, the authenticated join link in `DESCRIPTION`, `CLASS:PRIVATE`,
 * `TRANSP:OPAQUE` and `X-MICROSOFT-CDO-BUSYSTATUS:BUSY` (CW-R-44).
 *
 * Times are written as local wall-clock values with `TZID` set to the
 * appointment's IANA zone, and a `VTIMEZONE` describes that zone's offsets
 * around the event (guidelines section 10.2). The observances are computed
 * from `Intl` as one-off onsets (no `RRULE`): the transitions in the year
 * before the event and during it, which is exactly what a client needs to
 * place this one event. The second occurrence of a repeated local hour (the
 * autumn change) cannot be written with `TZID`, which always means the first
 * occurrence, so that instant is written in UTC instead.
 *
 * Lines are folded at 75 octets (not characters) without splitting a UTF-8
 * sequence, TEXT values escape `\ ; ,` and line breaks, and every line ends
 * with CRLF (RFC 5545 sections 3.1 and 3.3.11).
 *
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md section 10.2
 */

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsEvent {
  /** Stable across updates and the cancellation of the same event; see {@link icsUid}. */
  uid: string;
  /** Neutral, for example "NestSelf session" or "NestSelf webinar". */
  summary: string;
  /** The authenticated join link, with a short neutral sentence. */
  description: string;
  dtstart: Date;
  dtend: Date;
  /** IANA zone of the appointment or webinar, for example `Europe/Belgrade`. */
  timeZone: string;
  /** `REQUEST` (default) adds or updates the event; `CANCEL` removes it. */
  method?: IcsMethod;
  /** Incremented by the caller on every update and on cancellation. */
  sequence?: number;
  /** Generation time, defaults to now. */
  dtstamp?: Date;
  classification?: 'PRIVATE';
  busyStatus?: 'BUSY';
}

/** Right-hand side of every `UID`; any stable domain we control will do. */
export const ICS_UID_DOMAIN = 'nestself.rs';

const PRODID = '-//NestSelf//Calls//EN';
const MAX_LINE_OCTETS = 75;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** How far before the event to look for offset transitions. */
const LOOKBACK_MS = 366 * DAY_MS;
/** Distance of the probes that find the other offset around an instant. */
const PROBE_MS = 6 * 3_600_000;

/** Deterministic `UID` from the record id, for example `appointment-<id>@nestself.rs`. */
export function icsUid(kind: 'appointment' | 'webinar-registration', id: string): string {
  return `${kind}-${id}@${ICS_UID_DOMAIN}`;
}

/** Escapes a TEXT value (RFC 5545 section 3.3.11). */
export function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Folds one content line so that no physical line exceeds 75 octets, the
 * leading space of a continuation line included. Iterates by code point, so a
 * multi-octet character is never split across lines.
 */
export function foldLine(line: string): string {
  const physical: string[] = [];
  let current = '';
  let currentOctets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0)!);
    if (currentOctets + size > limit) {
      physical.push(current);
      current = char;
      currentOctets = size;
      limit = MAX_LINE_OCTETS - 1;
    } else {
      current += char;
      currentOctets += size;
    }
  }
  physical.push(current);
  return physical.join('\r\n ');
}

// ---------------------------------------------------------------------------
// Time zones through Intl
// ---------------------------------------------------------------------------

interface WallClock {
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

function wallClock(timeZone: string, ms: number): WallClock {
  const parts = formatterFor(timeZone).formatToParts(ms);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** UTC offset of `timeZone` at the instant `ms`, in minutes east of UTC. */
function offsetMinutes(timeZone: string, ms: number): number {
  const wall = wallClock(timeZone, ms);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((wallAsUtc - Math.floor(ms / 1000) * 1000) / MINUTE_MS);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function formatWall(wall: WallClock): string {
  return `${pad(wall.year, 4)}${pad(wall.month)}${pad(wall.day)}T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second)}`;
}

function formatUtc(ms: number): string {
  const date = new Date(ms);
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`;
}

/** Wall-clock value of a UTC instant shifted by a fixed offset. */
function shiftedWall(ms: number, offset: number): WallClock {
  const shifted = new Date(ms + offset * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/**
 * True when the local wall-clock time of `ms` also occurred earlier under
 * another offset (the repeated hour after a backward change). `TZID` values
 * resolve to the first occurrence, so such an instant must be written in UTC.
 */
function isRepeatedLocalTime(timeZone: string, ms: number): boolean {
  const offset = offsetMinutes(timeZone, ms);
  const local = ms + offset * MINUTE_MS;
  for (const probe of [-PROBE_MS, PROBE_MS]) {
    const other = offsetMinutes(timeZone, ms + probe);
    if (other === offset) continue;
    const candidate = local - other * MINUTE_MS;
    if (candidate < ms && offsetMinutes(timeZone, candidate) === other) return true;
  }
  return false;
}

function dateTimeProperty(name: 'DTSTART' | 'DTEND', timeZone: string, ms: number): string {
  if (isRepeatedLocalTime(timeZone, ms)) return `${name}:${formatUtc(ms)}`;
  return `${name};TZID=${timeZone}:${formatWall(wallClock(timeZone, ms))}`;
}

interface Transition {
  /** First instant (whole minute) of the new offset. */
  at: number;
  from: number;
  to: number;
}

/** Offset transitions in `[start, end]`, found by daily sampling and a binary search to the minute. */
function transitionsBetween(timeZone: string, start: number, end: number): Transition[] {
  const found: Transition[] = [];
  let previous = Math.floor(start / MINUTE_MS) * MINUTE_MS;
  let previousOffset = offsetMinutes(timeZone, previous);
  while (previous < end) {
    const next = Math.min(previous + DAY_MS, end);
    const nextOffset = offsetMinutes(timeZone, next);
    if (nextOffset !== previousOffset) {
      let low = previous;
      let high = next;
      while (high - low > MINUTE_MS) {
        const middle = Math.floor((low + high) / 2 / MINUTE_MS) * MINUTE_MS;
        if (offsetMinutes(timeZone, middle) === previousOffset) low = middle;
        else high = middle;
      }
      found.push({ at: high, from: previousOffset, to: offsetMinutes(timeZone, high) });
    }
    previous = next;
    previousOffset = nextOffset;
  }
  return found;
}

function observance(kind: 'STANDARD' | 'DAYLIGHT', onset: string, from: number, to: number): string[] {
  return [
    `BEGIN:${kind}`,
    `DTSTART:${onset}`,
    `TZOFFSETFROM:${formatOffset(from)}`,
    `TZOFFSETTO:${formatOffset(to)}`,
    `END:${kind}`,
  ];
}

/** Minimal VTIMEZONE covering `[dtstart, dtend]` (see the module comment). */
function vtimezone(timeZone: string, dtstart: number, dtend: number): string[] {
  const transitions = transitionsBetween(timeZone, dtstart - LOOKBACK_MS, dtend);
  const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
  const first = transitions[0];
  if (!first || first.at > dtstart) {
    const offset = first ? first.from : offsetMinutes(timeZone, dtstart);
    lines.push(...observance('STANDARD', '19700101T000000', offset, offset));
  }
  for (const transition of transitions) {
    // The onset is the local time just before the change, in the old offset.
    const onset = formatWall(shiftedWall(transition.at, transition.from));
    const kind = transition.to > transition.from ? 'DAYLIGHT' : 'STANDARD';
    lines.push(...observance(kind, onset, transition.from, transition.to));
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

function assertTimeZone(timeZone: string): void {
  // TZID is written unquoted, so only IANA name characters are accepted.
  if (!/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) {
    throw new RangeError(`Invalid time zone: ${timeZone}`);
  }
  // Throws RangeError for a zone the runtime does not know.
  formatterFor(timeZone);
}

/** Builds the calendar file. Returns CRLF-terminated, folded RFC 5545 text. */
export function generateIcs(event: IcsEvent): string {
  const start = event.dtstart.getTime();
  const end = event.dtend.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new RangeError('dtend must be after dtstart');
  }
  const sequence = event.sequence ?? 0;
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError('sequence must be a non-negative integer');
  }
  assertTimeZone(event.timeZone);
  const method = event.method ?? 'REQUEST';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    ...vtimezone(event.timeZone, start, end),
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${formatUtc((event.dtstamp ?? new Date()).getTime())}`,
    `SEQUENCE:${sequence}`,
    dateTimeProperty('DTSTART', event.timeZone, start),
    dateTimeProperty('DTEND', event.timeZone, end),
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `CLASS:${event.classification ?? 'PRIVATE'}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    `X-MICROSOFT-CDO-BUSYSTATUS:${event.busyStatus ?? 'BUSY'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
