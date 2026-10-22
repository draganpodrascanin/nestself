import { describe, it, expect } from 'vitest';
import {
  generateToken,
  hashToken,
  constantTimeHashCompare,
} from './invitation-token.js';

describe('invitation-token', () => {
  describe('generateToken', () => {
    it('produces a 64-character hex string (32 bytes)', () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces unique tokens', () => {
      const a = generateToken();
      const b = generateToken();
      expect(a).not.toBe(b);
    });
  });

  describe('hashToken', () => {
    it('returns a 64-character hex SHA-256 digest', () => {
      const hash = hashToken('abc');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      const token = generateToken();
      expect(hashToken(token)).toBe(hashToken(token));
    });

    it('different tokens produce different hashes', () => {
      expect(hashToken('a')).not.toBe(hashToken('b'));
    });
  });

  describe('constantTimeHashCompare', () => {
    it('returns true for identical strings', () => {
      const h = hashToken('test');
      expect(constantTimeHashCompare(h, h)).toBe(true);
    });

    it('returns false for different strings of the same length', () => {
      const a = hashToken('a');
      const b = hashToken('b');
      expect(constantTimeHashCompare(a, b)).toBe(false);
    });

    it('returns false for different lengths', () => {
      expect(constantTimeHashCompare('short', 'a-longer-string')).toBe(false);
    });
  });
});
