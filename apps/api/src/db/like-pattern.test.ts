import { describe, it, expect } from 'vitest';
import { likePrefix } from './like-pattern.js';

describe('likePrefix', () => {
  it('turns a plain term into a prefix pattern', () => {
    expect(likePrefix('ana')).toBe('ana%');
    expect(likePrefix('')).toBe('%');
  });

  // PostgreSQL's default LIKE escape character is the backslash.
  it.each([
    ['a percent sign', '50%', '50\\%%'],
    ['an underscore', 'a_b', 'a\\_b%'],
    ['a backslash', 'C:\\dir', 'C:\\\\dir%'],
    ['all three, in a row', '%_\\', '\\%\\_\\\\%'],
  ])('escapes %s so that it matches itself', (_name, term, pattern) => {
    expect(likePrefix(term)).toBe(pattern);
  });

  it('leaves other punctuation alone', () => {
    expect(likePrefix("o'neil+x@mail.example")).toBe("o'neil+x@mail.example%");
  });
});
