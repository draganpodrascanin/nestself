/**
 * RFC 5545 generator tests: folding at 75 octets (multi-byte safe), TEXT
 * escaping, time zones (TZID, VTIMEZONE, daylight saving), the neutral
 * private VEVENT of D-CW-26 / CW-R-44 and the CANCEL variant (CW-R-45).
 */
import { describe, expect, it } from 'vitest';
import {
  ICS_UID_DOMAIN,
  escapeText,
  foldLine,
  generateIcs,
  icsUid,
  type IcsEvent,
} from './ics-generator.js';

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

function octets(value: string): number {
  return encoder.encode(value).length;
}

/** Physical lines of an ICS document (without the CRLF terminators). */
function physicalLines(ics: string): string[] {
  expect(ics.endsWith('\r\n')).toBe(true);
  return ics.slice(0, -2).split('\r\n');
}

/** RFC 5545 section 3.1 unfolding: CRLF followed by one space is removed. */
function unfold(ics: string): string[] {
  return ics.replaceAll('\r\n ', '').slice(0, -2).split('\r\n');
}

/** A property of the VEVENT (VTIMEZONE observances carry their own DTSTART). */
function property(ics: string, name: string): string | undefined {
  return component(ics, 'VEVENT').find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
}

/** Lines between BEGIN:<component> and END:<component>, first occurrence. */
function component(ics: string, name: string): string[] {
  const lines = unfold(ics);
  const start = lines.indexOf(`BEGIN:${name}`);
  const end = lines.indexOf(`END:${name}`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  return lines.slice(start + 1, end);
}

function observances(ics: string): { kind: string; lines: string[] }[] {
  const lines = component(ics, 'VTIMEZONE');
  const result: { kind: string; lines: string[] }[] = [];
  let current: { kind: string; lines: string[] } | null = null;
  for (const line of lines) {
    const begin = /^BEGIN:(STANDARD|DAYLIGHT)$/.exec(line);
    if (begin) {
      current = { kind: begin[1]!, lines: [] };
    } else if (/^END:(STANDARD|DAYLIGHT)$/.test(line)) {
      result.push(current!);
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return result;
}

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: icsUid('appointment', 'appt-1'),
    summary: 'NestSelf session',
    description: 'Sign in to NestSelf to join: https://app.nestself.rs/appointments/appt-1',
    dtstart: new Date('2026-11-02T09:00:00Z'),
    dtend: new Date('2026-11-02T09:50:00Z'),
    timeZone: 'Europe/Belgrade',
    dtstamp: new Date('2026-10-24T10:15:30.456Z'),
    ...overrides,
  };
}

describe('escapeText', () => {
  it('escapes backslash, semicolon and comma', () => {
    expect(escapeText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
  });

  it('escapes the backslash first so escapes are not doubled', () => {
    expect(escapeText('\\;')).toBe('\\\\\\;');
  });

  it('turns LF, CRLF and CR line breaks into \\n', () => {
    expect(escapeText('one\ntwo\r\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour');
  });

  it('leaves colons and double quotes alone in TEXT values', () => {
    expect(escapeText('https://app.nestself.rs/a?b="c"')).toBe('https://app.nestself.rs/a?b="c"');
  });
});

describe('foldLine', () => {
  it('leaves a line of exactly 75 octets unfolded', () => {
    const line = `DESCRIPTION:${'x'.repeat(75 - 'DESCRIPTION:'.length)}`;
    expect(octets(line)).toBe(75);
    expect(foldLine(line)).toBe(line);
  });

  it('folds a 76-octet line into 75 octets and a continuation starting with one space', () => {
    const line = `DESCRIPTION:${'x'.repeat(76 - 'DESCRIPTION:'.length)}`;
    const folded = foldLine(line).split('\r\n');
    expect(folded).toHaveLength(2);
    expect(octets(folded[0]!)).toBe(75);
    expect(folded[1]).toBe(' x');
  });

  it('keeps every physical line, continuation space included, within 75 octets', () => {
    const line = `DESCRIPTION:${'abcdefghij'.repeat(40)}`;
    const folded = foldLine(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(5);
    for (const physical of folded) expect(octets(physical)).toBeLessThanOrEqual(75);
    for (const continuation of folded.slice(1)) expect(continuation.startsWith(' ')).toBe(true);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(line);
  });

  it.each([
    ['Serbian Cyrillic (2 octets each)', 'Подсетник: наредна сесија почиње у договорено време, придружите се преко апликације.'],
    ['Hungarian accents (ő, ű, á: 2 octets each)', 'Emlékeztető: következő alkalom, nyissa meg az alkalmazást időben, őszintén és nyugodtan, ünnepélyesen.'],
    ['Serbian Latin diacritics', 'Podsetnik: naredna sesija, ćevapčići, đak, šuma, žaba, čaša, Ćirilica, Đurđevdan, Šabac, Žabalj.'],
    ['astral symbols (4 octets each)', `${'🙂'.repeat(60)}`],
  ])('never splits a multi-octet character: %s', (_label, text) => {
    const line = `SUMMARY:${text}`;
    const folded = foldLine(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    for (const physical of folded) {
      const bytes = encoder.encode(physical);
      expect(bytes.length).toBeLessThanOrEqual(75);
      // A split sequence would make the physical line invalid UTF-8.
      expect(() => strictDecoder.decode(bytes)).not.toThrow();
    }
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(line);
  });

  it('measures octets, not characters: 75 Cyrillic characters need folding', () => {
    const line = 'ж'.repeat(75);
    expect(line.length).toBe(75);
    const folded = foldLine(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    // 37 two-octet characters fill 74 octets; a 38th would make 76.
    expect(folded[0]).toBe('ж'.repeat(37));
  });
});

describe('icsUid', () => {
  it('is deterministic from the kind and id plus the NestSelf domain', () => {
    expect(icsUid('appointment', 'appt-1')).toBe(`appointment-appt-1@${ICS_UID_DOMAIN}`);
    expect(icsUid('appointment', 'appt-1')).toBe(icsUid('appointment', 'appt-1'));
    expect(icsUid('webinar-registration', 'reg-9')).toBe(`webinar-registration-reg-9@${ICS_UID_DOMAIN}`);
  });
});

describe('generateIcs', () => {
  it('uses CRLF line endings everywhere and ends with CRLF', () => {
    const ics = generateIcs(event());
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('keeps every physical line within 75 octets', () => {
    const ics = generateIcs(
      event({
        description: `Пријавите се на NestSelf да бисте се придружили: https://app.nestself.rs/appointments/${'a'.repeat(120)}`,
      }),
    );
    for (const line of physicalLines(ics)) expect(octets(line)).toBeLessThanOrEqual(75);
  });

  it('wraps one VEVENT in a VCALENDAR with METHOD:REQUEST by default', () => {
    const lines = unfold(generateIcs(event()));
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('PRODID:-//NestSelf//Calls//EN');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines).toContain('METHOD:REQUEST');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('writes the neutral, private, busy event of D-CW-26', () => {
    const vevent = component(generateIcs(event()), 'VEVENT');
    expect(vevent).toContain(`UID:appointment-appt-1@${ICS_UID_DOMAIN}`);
    expect(vevent).toContain('SUMMARY:NestSelf session');
    expect(vevent).toContain('CLASS:PRIVATE');
    expect(vevent).toContain('STATUS:CONFIRMED');
    expect(vevent).toContain('TRANSP:OPAQUE');
    expect(vevent).toContain('X-MICROSOFT-CDO-BUSYSTATUS:BUSY');
    expect(vevent).toContain('SEQUENCE:0');
  });

  it('puts the authenticated join link in DESCRIPTION, escaped', () => {
    const ics = generateIcs(
      event({ description: 'Join, then wait; the link: https://app.nestself.rs/appointments/appt-1' }),
    );
    expect(property(ics, 'DESCRIPTION')).toBe(
      'DESCRIPTION:Join\\, then wait\\; the link: https://app.nestself.rs/appointments/appt-1',
    );
  });

  it('escapes SUMMARY text and multi-line descriptions', () => {
    const ics = generateIcs(event({ summary: 'NestSelf; session, \\ test', description: 'Line one\nLine two' }));
    expect(property(ics, 'SUMMARY')).toBe('SUMMARY:NestSelf\\; session\\, \\\\ test');
    expect(property(ics, 'DESCRIPTION')).toBe('DESCRIPTION:Line one\\nLine two');
  });

  it('writes DTSTAMP in UTC without milliseconds', () => {
    expect(property(generateIcs(event()), 'DTSTAMP')).toBe('DTSTAMP:20261024T101530Z');
  });

  it('defaults DTSTAMP to the current time', () => {
    const before = Date.now();
    const stamp = property(generateIcs(event({ dtstamp: undefined })), 'DTSTAMP')!;
    const match = /^DTSTAMP:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp)!;
    const value = Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, +match[4]!, +match[5]!, +match[6]!);
    expect(value).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(value).toBeLessThanOrEqual(Date.now());
  });

  it('carries the SEQUENCE for updates', () => {
    expect(property(generateIcs(event({ sequence: 3 })), 'SEQUENCE')).toBe('SEQUENCE:3');
  });

  it('writes the CANCEL variant with the same UID and STATUS:CANCELLED', () => {
    const ics = generateIcs(event({ method: 'CANCEL', sequence: 1 }));
    const lines = unfold(ics);
    expect(lines).toContain('METHOD:CANCEL');
    const vevent = component(ics, 'VEVENT');
    expect(vevent).toContain('STATUS:CANCELLED');
    expect(vevent).toContain('SEQUENCE:1');
    expect(vevent).toContain(`UID:appointment-appt-1@${ICS_UID_DOMAIN}`);
    expect(vevent).toContain('CLASS:PRIVATE');
  });

  it('refuses an end that is not after the start', () => {
    expect(() => generateIcs(event({ dtend: new Date('2026-11-02T09:00:00Z') }))).toThrow(RangeError);
  });

  it('refuses an unknown or malformed time zone', () => {
    expect(() => generateIcs(event({ timeZone: 'Mars/Olympus_Mons' }))).toThrow(RangeError);
    expect(() => generateIcs(event({ timeZone: 'Europe/Belgrade;X=1' }))).toThrow(RangeError);
  });

  it('refuses a negative or fractional SEQUENCE', () => {
    expect(() => generateIcs(event({ sequence: -1 }))).toThrow(RangeError);
    expect(() => generateIcs(event({ sequence: 1.5 }))).toThrow(RangeError);
  });
});

describe('generateIcs time zones', () => {
  it('writes local wall-clock DTSTART and DTEND with TZID in winter (CET, +01:00)', () => {
    const ics = generateIcs(event());
    expect(property(ics, 'DTSTART')).toBe('DTSTART;TZID=Europe/Belgrade:20261102T100000');
    expect(property(ics, 'DTEND')).toBe('DTEND;TZID=Europe/Belgrade:20261102T105000');
  });

  it('writes local wall-clock time in summer (CEST, +02:00)', () => {
    const ics = generateIcs(
      event({ dtstart: new Date('2026-07-01T08:00:00Z'), dtend: new Date('2026-07-01T09:00:00Z') }),
    );
    expect(property(ics, 'DTSTART')).toBe('DTSTART;TZID=Europe/Belgrade:20260701T100000');
    expect(property(ics, 'DTEND')).toBe('DTEND;TZID=Europe/Belgrade:20260701T110000');
  });

  it.each([
    ['America/New_York', '2026-01-15T15:00:00Z', '20260115T100000'],
    ['Asia/Kolkata', '2026-03-10T04:30:00Z', '20260310T100000'],
    ['Etc/UTC', '2026-03-10T10:00:00Z', '20260310T100000'],
    ['Pacific/Auckland', '2026-01-14T21:00:00Z', '20260115T100000'],
  ])('converts to %s wall-clock time', (timeZone, start, local) => {
    const dtstart = new Date(start);
    const ics = generateIcs(event({ timeZone, dtstart, dtend: new Date(dtstart.getTime() + 3_600_000) }));
    expect(property(ics, 'DTSTART')).toBe(`DTSTART;TZID=${timeZone}:${local}`);
    expect(component(ics, 'VTIMEZONE')[0]).toBe(`TZID:${timeZone}`);
  });

  it('describes the Belgrade daylight saving transitions around the event in VTIMEZONE', () => {
    const ics = generateIcs(event());
    expect(component(ics, 'VTIMEZONE')[0]).toBe('TZID:Europe/Belgrade');
    const found = observances(ics);
    const daylight = found.find((o) => o.lines.includes('DTSTART:20260329T020000'));
    const standard = found.find((o) => o.lines.includes('DTSTART:20261025T030000'));
    expect(daylight).toEqual({
      kind: 'DAYLIGHT',
      lines: ['DTSTART:20260329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200'],
    });
    expect(standard).toEqual({
      kind: 'STANDARD',
      lines: ['DTSTART:20261025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100'],
    });
  });

  it('covers the event start: the latest observance onset is not after DTSTART', () => {
    const ics = generateIcs(
      event({ dtstart: new Date('2026-07-01T08:00:00Z'), dtend: new Date('2026-07-01T09:00:00Z') }),
    );
    const onsets = observances(ics).map((o) => o.lines[0]!.slice('DTSTART:'.length));
    expect(onsets.some((onset) => onset <= '20260701T100000')).toBe(true);
    expect(onsets).toContain('20260329T020000');
  });

  it('writes a single fixed STANDARD observance for a zone without daylight saving', () => {
    const ics = generateIcs(
      event({
        timeZone: 'Asia/Kolkata',
        dtstart: new Date('2026-03-10T04:30:00Z'),
        dtend: new Date('2026-03-10T05:30:00Z'),
      }),
    );
    expect(observances(ics)).toEqual([
      { kind: 'STANDARD', lines: ['DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530'] },
    ]);
  });

  it('writes negative offsets with a minus sign', () => {
    const ics = generateIcs(
      event({
        timeZone: 'America/New_York',
        dtstart: new Date('2026-01-15T15:00:00Z'),
        dtend: new Date('2026-01-15T16:00:00Z'),
      }),
    );
    const lines = observances(ics).flatMap((o) => o.lines);
    expect(lines).toContain('TZOFFSETTO:-0500');
    expect(lines).toContain('TZOFFSETTO:-0400');
  });

  it('handles an event spanning the autumn change (CEST start, CET end)', () => {
    const ics = generateIcs(
      event({ dtstart: new Date('2026-10-25T00:30:00Z'), dtend: new Date('2026-10-25T02:30:00Z') }),
    );
    expect(property(ics, 'DTSTART')).toBe('DTSTART;TZID=Europe/Belgrade:20261025T023000');
    expect(property(ics, 'DTEND')).toBe('DTEND;TZID=Europe/Belgrade:20261025T033000');
  });

  it('writes UTC for the second occurrence of a repeated local hour, which TZID cannot express', () => {
    // 01:30Z is 02:30 CET, the repeated hour; with TZID it would read as 02:30 CEST (00:30Z).
    const ics = generateIcs(
      event({ dtstart: new Date('2026-10-25T01:30:00Z'), dtend: new Date('2026-10-25T02:30:00Z') }),
    );
    expect(property(ics, 'DTSTART')).toBe('DTSTART:20261025T013000Z');
    expect(property(ics, 'DTEND')).toBe('DTEND;TZID=Europe/Belgrade:20261025T033000');
  });

  it('handles an event across the spring change (the skipped hour never appears)', () => {
    const ics = generateIcs(
      event({ dtstart: new Date('2026-03-29T00:30:00Z'), dtend: new Date('2026-03-29T01:30:00Z') }),
    );
    expect(property(ics, 'DTSTART')).toBe('DTSTART;TZID=Europe/Belgrade:20260329T013000');
    expect(property(ics, 'DTEND')).toBe('DTEND;TZID=Europe/Belgrade:20260329T033000');
  });
});
