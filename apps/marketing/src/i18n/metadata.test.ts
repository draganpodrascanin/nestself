import { describe, it, expect } from 'vitest';
import { localeAlternates, localizedMetadata, SITE_URL } from './metadata';

describe('SITE_URL', () => {
  it('defaults to http://localhost:3000', () => {
    expect(SITE_URL).toBe('http://localhost:3000');
  });
});

describe('localeAlternates', () => {
  it('contains all four locales with correct paths', () => {
    const result = localeAlternates('/services');
    expect(result.languages['en']).toBe(`${SITE_URL}/en/services`);
    expect(result.languages['sr-Latn']).toBe(`${SITE_URL}/sr-Latn/services`);
    expect(result.languages['sr-Cyrl']).toBe(`${SITE_URL}/sr-Cyrl/services`);
    expect(result.languages['hu']).toBe(`${SITE_URL}/hu/services`);
  });

  it('sets x-default to English', () => {
    const result = localeAlternates('/services');
    expect(result.languages['x-default']).toBe(`${SITE_URL}/en/services`);
  });

  it('has canonical pointing to English', () => {
    const result = localeAlternates('/');
    expect(result.canonical).toBe(`${SITE_URL}/en/`);
  });
});

describe('localizedMetadata', () => {
  it('returns metadata with alternates', () => {
    const meta = localizedMetadata({
      locale: 'sr-Latn',
      title: 'Test',
      description: 'Desc',
      pathname: '/for-employers',
    });
    expect(meta.title).toBe('Test');
    expect(meta.description).toBe('Desc');
    expect(meta.alternates?.languages).toHaveProperty('sr-Latn');
    expect(meta.alternates?.languages).toHaveProperty('x-default');
    expect(meta.alternates?.languages).toHaveProperty('hu');
  });

  it('includes metadataBase', () => {
    const meta = localizedMetadata({
      locale: 'en',
      title: 'Home',
      pathname: '',
    });
    expect(meta.metadataBase).toBeInstanceOf(URL);
    expect((meta.metadataBase as URL).href).toContain('localhost');
  });

  it('includes openGraph.images pointing to OG image route', () => {
    const meta = localizedMetadata({
      locale: 'hu',
      title: 'Teszt',
      pathname: '/about',
    });
    const og = meta.openGraph;
    expect(og).toBeDefined();
    expect(og!.images).toEqual(['/hu/opengraph-image']);
  });

  it('includes twitter card summary_large_image', () => {
    const meta = localizedMetadata({
      locale: 'en',
      title: 'Home',
      pathname: '',
    });
    expect(meta.twitter).toEqual({ card: 'summary_large_image' });
  });

  it('includes all four locales plus x-default in alternates', () => {
    const meta = localizedMetadata({
      locale: 'en',
      title: 'Home',
      pathname: '/plans',
    });
    const langs = meta.alternates?.languages as Record<string, string>;
    expect(langs).toHaveProperty('en');
    expect(langs).toHaveProperty('sr-Latn');
    expect(langs).toHaveProperty('sr-Cyrl');
    expect(langs).toHaveProperty('hu');
    expect(langs).toHaveProperty('x-default');
  });
});
