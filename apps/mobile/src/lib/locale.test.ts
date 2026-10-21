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

  it('falls back to Serbian Latin for unknown locales', () => {
    expect(resolveDeviceLocale(['ja', 'zh'])).toBe('sr-Latn');
  });

  it('returns Serbian Latin for an empty list', () => {
    expect(resolveDeviceLocale([])).toBe('sr-Latn');
  });

  it('picks the first matching tag', () => {
    expect(resolveDeviceLocale(['fr', 'sr-Latn', 'en'])).toBe('sr-Latn');
  });
});
