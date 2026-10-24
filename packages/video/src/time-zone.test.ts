import { describe, expect, it } from 'vitest';
import { formatInZone, zonedDateTimeToIso } from './time-zone';

describe('zonedDateTimeToIso', () => {
  it('converts a wall-clock time in Belgrade to UTC, winter and summer', () => {
    expect(zonedDateTimeToIso('2030-01-15', '10:30', 'Europe/Belgrade')).toBe('2030-01-15T09:30:00.000Z');
    expect(zonedDateTimeToIso('2030-07-15', '10:30', 'Europe/Belgrade')).toBe('2030-07-15T08:30:00.000Z');
  });

  it('handles the daylight-saving switch days', () => {
    // 31 March 2030: clocks go from 02:00 to 03:00 in Belgrade.
    expect(zonedDateTimeToIso('2030-03-31', '03:30', 'Europe/Belgrade')).toBe('2030-03-31T01:30:00.000Z');
    // 27 October 2030: 02:30 happens twice; the first (summer time) is used.
    expect(zonedDateTimeToIso('2030-10-27', '02:30', 'Europe/Belgrade')).toBe('2030-10-27T00:30:00.000Z');
    // A time skipped by the spring switch resolves forward.
    expect(zonedDateTimeToIso('2030-03-31', '02:30', 'Europe/Belgrade')).toBe('2030-03-31T01:30:00.000Z');
  });

  it('works for other zones and rejects malformed input', () => {
    expect(zonedDateTimeToIso('2030-01-15', '10:30', 'Etc/UTC')).toBe('2030-01-15T10:30:00.000Z');
    expect(zonedDateTimeToIso('2030-1-15', '10:30', 'Europe/Belgrade')).toBeNull();
    expect(zonedDateTimeToIso('2030-01-15', '', 'Europe/Belgrade')).toBeNull();
  });
});

describe('formatInZone', () => {
  it('formats date and time in the appointment time zone and locale', () => {
    const { date, time } = formatInZone('2030-01-15T09:30:00.000Z', 'Europe/Belgrade', 'en');
    expect(time).toMatch(/10:30/);
    expect(date).toMatch(/15/);
    expect(date).toMatch(/2030/);
  });
});
