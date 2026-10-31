import { describe, expect, it } from 'vitest';
import { emailDomain, maskEmail } from './mask-email.js';

describe('maskEmail', () => {
  it('keeps the first character of the local part and the whole domain', () => {
    expect(maskEmail('dragan@intesa.example')).toBe('d***@intesa.example');
  });

  it('hides a one-character local part entirely', () => {
    expect(maskEmail('a@b.c')).toBe('*@b.c');
  });

  it('does not reveal how long the local part is', () => {
    expect(maskEmail('ab@intesa.example')).toBe('a***@intesa.example');
    expect(maskEmail('a.very.long.name@intesa.example')).toBe('a***@intesa.example');
  });

  it('takes the domain after the last @', () => {
    expect(maskEmail('odd@name@intesa.example')).toBe('o***@intesa.example');
  });

  it('keeps a whole code point, not half of a surrogate pair', () => {
    expect(maskEmail('\u{1F600}x@intesa.example')).toBe('\u{1F600}***@intesa.example');
  });

  it('never echoes input that is not an address', () => {
    expect(maskEmail('not-an-address')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('emailDomain', () => {
  it('returns what follows the last @', () => {
    expect(emailDomain('dragan@intesa.example')).toBe('intesa.example');
    expect(emailDomain('odd@name@intesa.example')).toBe('intesa.example');
  });

  it('answers "unknown" instead of echoing a string without an @', () => {
    expect(emailDomain('not-an-address')).toBe('unknown');
  });
});
