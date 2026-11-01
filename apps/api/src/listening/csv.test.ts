import { describe, expect, it } from 'vitest';
import { csvCell, csvDocument, csvLine } from './csv.js';

describe('csv helpers (spec REP-04)', () => {
  it('neutralises formula-leading text', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-8.0')).toBe("'-8.0");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tx')).toBe("'\tx");
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('writes empty cells for null and undefined and plain text otherwise', () => {
    expect(csvLine(['a', null, undefined, 48, 'ok'])).toBe('a,,,48,ok');
  });

  it('joins with CRLF and ends with a line break', () => {
    expect(csvDocument(['h1', 'h2'], [['x', 1], ['y', null]])).toBe('h1,h2\r\nx,1\r\ny,\r\n');
  });
});
