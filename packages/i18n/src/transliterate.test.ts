import { beforeAll, describe, expect, it } from 'vitest';

describe('transliterate', () => {
  let transliterate: (input: string) => string;

  beforeAll(async () => {
    const mod = await import('../scripts/transliterate-core.mjs');
    transliterate = mod.transliterate;
  });

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
