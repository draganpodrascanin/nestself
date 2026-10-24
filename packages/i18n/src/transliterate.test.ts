import { describe, expect, it } from 'vitest';

import { transliterate, transliterateObject } from './transliterate.ts';

describe('transliterate', () => {
  it('transliterates "Ljubljana i Njegoš" correctly', () => {
    expect(transliterate('Ljubljana i Njegoš')).toBe('Љубљана и Његош');
  });

  it('transliterates "džem" correctly', () => {
    expect(transliterate('džem')).toBe('џем');
  });

  it('preserves {{placeholders}} untouched', () => {
    expect(transliterate('Zdravo, {{name}}')).toBe('Здраво, {{name}}');
  });

  it('preserves protected terms untouched', () => {
    const result = transliterate('Koristi NestSelf platformu');
    expect(result).toContain('NestSelf');
    expect(result).toBe('Користи NestSelf платформу');
  });

  it('applies "injekcija" word override', () => {
    expect(transliterate('injekcija')).toBe('инјекција');
  });

  it('preserves URLs', () => {
    const input = 'Poseti https://example.com/page';
    const result = transliterate(input);
    expect(result).toContain('https://example.com/page');
  });

  it('preserves HTML-like tags', () => {
    const input = 'Tekst <strong>važan</strong> tekst';
    const result = transliterate(input);
    expect(result).toContain('<strong>');
    expect(result).toContain('</strong>');
  });
});

describe('transliterateObject', () => {
  it('deep-transliterates all string values', () => {
    const input = { greeting: 'Zdravo', nested: { name: 'Beograd' } };
    const result = transliterateObject(input);
    expect(result.greeting).toBe('Здраво');
    expect(result.nested.name).toBe('Београд');
  });

  it('preserves non-string values', () => {
    const input = { count: 42, active: true, items: ['abc'] };
    const result = transliterateObject(input);
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.items[0]).toBe('абц');
  });
});
