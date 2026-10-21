import { describe, expect, it } from 'vitest';

import { formatArticleDate, formatWebinarDateTime } from './dates';

describe('formatArticleDate', () => {
  const iso = '2026-10-08';

  it('formats in English (long date)', () => {
    expect(formatArticleDate(iso, 'en')).toBe('8 October 2026');
  });

  it('formats in Serbian Latin', () => {
    expect(formatArticleDate(iso, 'sr-Latn')).toBe('8. oktobar 2026.');
  });

  it('formats in Serbian Cyrillic with Cyrillic month name', () => {
    const result = formatArticleDate(iso, 'sr-Cyrl');
    expect(result).toBe('8. октобар 2026.');
  });

  it('formats in Hungarian', () => {
    expect(formatArticleDate(iso, 'hu')).toBe('2026. október 8.');
  });
});

describe('formatWebinarDateTime', () => {
  // 2026-11-12T17:00:00Z is 18:00 CET in Europe/Belgrade (winter)
  const isoWinter = '2026-11-12T17:00:00Z';

  it('formats in English as "date, time TZ"', () => {
    expect(formatWebinarDateTime(isoWinter, 'en')).toBe(
      '12 November 2026, 18:00 CET',
    );
  });

  it('formats in Serbian Latin', () => {
    expect(formatWebinarDateTime(isoWinter, 'sr-Latn')).toBe(
      '12. novembar 2026., 18:00 CET',
    );
  });

  it('formats in Serbian Cyrillic with Cyrillic month name', () => {
    expect(formatWebinarDateTime(isoWinter, 'sr-Cyrl')).toBe(
      '12. новембар 2026., 18:00 CET',
    );
  });

  it('formats in Hungarian', () => {
    expect(formatWebinarDateTime(isoWinter, 'hu')).toBe(
      '2026. november 12., 18:00 CET',
    );
  });

  it('uses CEST for summer dates', () => {
    // 2026-07-15T16:00:00Z is 18:00 CEST in Europe/Belgrade (summer)
    const isoSummer = '2026-07-15T16:00:00Z';
    expect(formatWebinarDateTime(isoSummer, 'en')).toBe(
      '15 July 2026, 18:00 CEST',
    );
  });
});
