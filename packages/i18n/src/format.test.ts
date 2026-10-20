import { describe, expect, it } from 'vitest';

import { formatCurrency, formatDate } from './format';

describe('formatCurrency', () => {
  it('formats EUR in English locale', () => {
    expect(formatCurrency(45, 'EUR', 'en')).toBe('€45.00');
  });

  it('formats EUR in sr-Latn with comma decimal', () => {
    const result = formatCurrency(45, 'EUR', 'sr-Latn');
    expect(result).toContain('45,00');
  });

  it('formats RSD with 2 fraction digits', () => {
    const result = formatCurrency(1500, 'RSD', 'en');
    expect(result).toContain('1,500.00');
  });
});

describe('formatDate', () => {
  it('formats sr-Cyrl date with Cyrillic month name', () => {
    const result = formatDate('2026-10-21T12:00:00Z', 'sr-Cyrl');
    expect(result).toMatch(/октобар/i);
  });

  it('formats sr-Latn date with Latin month name', () => {
    const result = formatDate('2026-10-21T12:00:00Z', 'sr-Latn');
    expect(result).toMatch(/oktobar/i);
  });
});
