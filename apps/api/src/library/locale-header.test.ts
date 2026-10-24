import { describe, it, expect } from 'vitest';
import { parseAcceptLanguageLocale } from './locale-header.js';

describe('parseAcceptLanguageLocale', () => {
  it('defaults to sr-Latn when header is undefined', () => {
    expect(parseAcceptLanguageLocale(undefined)).toBe('sr-Latn');
  });

  it('defaults to sr-Latn when header is empty', () => {
    expect(parseAcceptLanguageLocale('')).toBe('sr-Latn');
  });

  it('returns sr-Latn for exact match', () => {
    expect(parseAcceptLanguageLocale('sr-Latn')).toBe('sr-Latn');
  });

  it('returns sr-Cyrl for exact match', () => {
    expect(parseAcceptLanguageLocale('sr-Cyrl')).toBe('sr-Cyrl');
  });

  it('returns hu for exact match', () => {
    expect(parseAcceptLanguageLocale('hu')).toBe('hu');
  });

  it('returns en for exact match', () => {
    expect(parseAcceptLanguageLocale('en')).toBe('en');
  });

  it('returns en for en-US', () => {
    expect(parseAcceptLanguageLocale('en-US')).toBe('en');
  });

  it('returns hu for hu-HU', () => {
    expect(parseAcceptLanguageLocale('hu-HU')).toBe('hu');
  });

  it('picks the highest quality locale', () => {
    expect(parseAcceptLanguageLocale('en;q=0.5, sr-Cyrl;q=0.9')).toBe('sr-Cyrl');
  });

  it('returns sr-Latn for sr alias', () => {
    expect(parseAcceptLanguageLocale('sr')).toBe('sr-Latn');
  });

  it('returns sr-Cyrl for sr-Cyrl-RS', () => {
    expect(parseAcceptLanguageLocale('sr-Cyrl-RS')).toBe('sr-Cyrl');
  });

  it('returns sr-Latn for unknown locales', () => {
    expect(parseAcceptLanguageLocale('ja')).toBe('sr-Latn');
  });

  it('handles multiple locales with quality values', () => {
    expect(parseAcceptLanguageLocale('de;q=0.3, hu;q=0.8, en;q=0.5')).toBe('hu');
  });
});
