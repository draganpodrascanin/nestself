import { describe, expect, it } from 'vitest';

import { isLocale, negotiateLocale, parseAcceptLanguage } from './types';

describe('negotiateLocale', () => {
  it('resolves sr-Latn-RS to sr-Latn', () => {
    expect(negotiateLocale(['sr-Latn-RS'])).toBe('sr-Latn');
  });

  it('resolves sr-RS to sr-Latn (bare sr maps to Latin)', () => {
    expect(negotiateLocale(['sr-RS'])).toBe('sr-Latn');
  });

  it('resolves sr-Cyrl-RS to sr-Cyrl', () => {
    expect(negotiateLocale(['sr-Cyrl-RS'])).toBe('sr-Cyrl');
  });

  it('resolves de,en-US to en', () => {
    expect(negotiateLocale(['de', 'en-US'])).toBe('en');
  });

  it('returns the Serbian Latin default for empty candidates', () => {
    expect(negotiateLocale([])).toBe('sr-Latn');
  });

  it('falls back to Serbian Latin when no candidate is supported', () => {
    expect(negotiateLocale(['de-DE', 'fr'])).toBe('sr-Latn');
  });

  it('returns exact match for supported locale', () => {
    expect(negotiateLocale(['sr-Latn'])).toBe('sr-Latn');
  });

  it('returns sr-Latn for bare sr', () => {
    expect(negotiateLocale(['sr'])).toBe('sr-Latn');
  });

  it('negotiates Hungarian from hu-HU and bare hu', () => {
    expect(negotiateLocale(['hu-HU'])).toBe('hu');
    expect(negotiateLocale(['hu'])).toBe('hu');
    expect(negotiateLocale(['de', 'hu;q=0.8'].map((t) => t.split(';')[0]!))).toBe('hu');
  });
  it('isLocale accepts hu', () => {
    expect(isLocale('hu')).toBe(true);
  });
});

describe('parseAcceptLanguage', () => {
  it('sorts by quality, highest first', () => {
    expect(parseAcceptLanguage('sr-Latn;q=0.8, en;q=0.9')).toEqual([
      'en',
      'sr-Latn',
    ]);
  });

  it('treats missing quality as 1.0', () => {
    expect(parseAcceptLanguage('en, sr-Latn;q=0.5')).toEqual([
      'en',
      'sr-Latn',
    ]);
  });

  it('handles a single tag', () => {
    expect(parseAcceptLanguage('sr-Cyrl')).toEqual(['sr-Cyrl']);
  });

  it('returns empty for empty string', () => {
    expect(parseAcceptLanguage('')).toEqual([]);
  });
});
