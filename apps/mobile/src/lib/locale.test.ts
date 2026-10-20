import { describe, it, expect } from 'vitest';
import { resolveDeviceLocale } from './locale';

describe('resolveDeviceLocale', () => {
  it('returns en for English tags', () => {
    expect(resolveDeviceLocale(['en-US', 'en'])).toBe('en');
  });

  it('returns sr-Latn for bare sr tag', () => {
    expect(resolveDeviceLocale(['sr'])).toBe('sr-Latn');
  });

  it('returns sr-Cyrl when Cyrl script is specified', () => {
    expect(resolveDeviceLocale(['sr-Cyrl-RS'])).toBe('sr-Cyrl');
  });

  it('returns sr-Latn for sr-Latn-RS', () => {
    expect(resolveDeviceLocale(['sr-Latn-RS'])).toBe('sr-Latn');
  });

  it('falls back to en for unknown locales', () => {
    expect(resolveDeviceLocale(['ja', 'zh'])).toBe('en');
  });

  it('returns en for an empty list', () => {
    expect(resolveDeviceLocale([])).toBe('en');
  });

  it('picks the first matching tag', () => {
    expect(resolveDeviceLocale(['fr', 'sr-Latn', 'en'])).toBe('sr-Latn');
  });
});
