import { describe, expect, it } from 'vitest';
import { FEEDBACK_PSEUDONYM_PATTERN } from '@nestself/contracts';
import { casePseudonym } from './pseudonym.js';

describe('casePseudonym', () => {
  it('matches the contract pattern and varies', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const value = casePseudonym();
      expect(value).toMatch(FEEDBACK_PSEUDONYM_PATTERN);
      seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(150);
  });
});
