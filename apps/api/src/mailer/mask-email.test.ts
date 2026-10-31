import { describe, expect, it } from 'vitest';
import { emailDomain, maskEmail } from './mask-email.js';

describe('maskEmail', () => {
  it('keeps the first character of the local part and the whole domain', () => {
    expect(maskEmail('ivana@acme.example')).toBe('i***@acme.example');
  });

  it('hides a one-character local part entirely', () => {
    expect(maskEmail('a@b.c')).toBe('*@b.c');
  });

  it('does not reveal how long the local part is', () => {
    expect(maskEmail('ab@acme.example')).toBe('a***@acme.example');
    expect(maskEmail('a.very.long.name@acme.example')).toBe('a***@acme.example');
  });

  it('takes the domain after the last @', () => {
    expect(maskEmail('odd@name@acme.example')).toBe('o***@acme.example');
  });

  it('keeps a whole code point, not half of a surrogate pair', () => {
    expect(maskEmail('\u{1F600}x@acme.example')).toBe('\u{1F600}***@acme.example');
  });

  it('never echoes input that is not an address', () => {
    expect(maskEmail('not-an-address')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('emailDomain', () => {
  it('returns what follows the last @', () => {
    expect(emailDomain('ivana@acme.example')).toBe('acme.example');
    expect(emailDomain('odd@name@acme.example')).toBe('acme.example');
  });

  it('answers "unknown" instead of echoing a string without an @', () => {
    expect(emailDomain('not-an-address')).toBe('unknown');
  });
});
