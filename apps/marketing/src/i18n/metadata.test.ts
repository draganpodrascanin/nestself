import { describe, it, expect } from 'vitest';
import { localeAlternates, localizedMetadata } from './metadata';

describe('localeAlternates', () => {
  it('contains all three locales with correct paths', () => {
    const result = localeAlternates('/support');
    expect(result.languages['en']).toContain('/en/support');
    expect(result.languages['sr-Latn']).toContain('/sr-Latn/support');
    expect(result.languages['sr-Cyrl']).toContain('/sr-Cyrl/support');
  });

  it('sets x-default to English', () => {
    const result = localeAlternates('/support');
    expect(result.languages['x-default']).toContain('/en/support');
  });

  it('has canonical pointing to English', () => {
    const result = localeAlternates('/');
    expect(result.canonical).toContain('/en/');
  });
});

describe('localizedMetadata', () => {
  it('returns metadata with alternates', () => {
    const meta = localizedMetadata({
      locale: 'sr-Latn',
      title: 'Test',
      description: 'Desc',
      pathname: '/employers',
    });
    expect(meta.title).toBe('Test');
    expect(meta.description).toBe('Desc');
    expect(meta.alternates?.languages).toHaveProperty('sr-Latn');
    expect(meta.alternates?.languages).toHaveProperty('x-default');
  });
});
