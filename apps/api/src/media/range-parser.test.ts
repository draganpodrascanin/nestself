/**
 * Unit tests for HTTP Range header parser.
 */
import { describe, it, expect } from 'vitest';
import { parseRangeHeader, resolveRange } from './range-parser.js';

describe('parseRangeHeader', () => {
  it('returns none for undefined header', () => {
    expect(parseRangeHeader(undefined)).toEqual({ type: 'none' });
  });

  it('returns none for empty string', () => {
    expect(parseRangeHeader('')).toEqual({ type: 'none' });
  });

  it('parses closed range: bytes=0-499', () => {
    expect(parseRangeHeader('bytes=0-499')).toEqual({ type: 'range', start: 0, end: 499 });
  });

  it('parses open-ended range: bytes=500-', () => {
    expect(parseRangeHeader('bytes=500-')).toEqual({ type: 'range', start: 500 });
  });

  it('parses suffix range: bytes=-500', () => {
    expect(parseRangeHeader('bytes=-500')).toEqual({ type: 'suffix', suffixLength: 500 });
  });

  it('returns invalid for reversed range: bytes=500-0', () => {
    expect(parseRangeHeader('bytes=500-0')).toEqual({ type: 'invalid' });
  });

  it('returns unknown_unit for non-bytes unit (M11)', () => {
    expect(parseRangeHeader('chars=0-10')).toEqual({ type: 'unknown_unit' });
  });

  it('returns multiple for multi-range', () => {
    expect(parseRangeHeader('bytes=0-10, 20-30')).toEqual({ type: 'multiple' });
  });

  it('returns invalid for suffix of 0', () => {
    expect(parseRangeHeader('bytes=-0')).toEqual({ type: 'invalid' });
  });

  it('returns invalid for garbage', () => {
    expect(parseRangeHeader('bytes=abc')).toEqual({ type: 'invalid' });
  });

  // ── New tests from security review (M11) ──

  it('case-insensitive: Bytes=0-1 → range', () => {
    expect(parseRangeHeader('Bytes=0-1')).toEqual({ type: 'range', start: 0, end: 1 });
  });

  it('case-insensitive: BYTES=10-20 → range', () => {
    expect(parseRangeHeader('BYTES=10-20')).toEqual({ type: 'range', start: 10, end: 20 });
  });

  it('unknown unit pages=1-5 → unknown_unit', () => {
    expect(parseRangeHeader('pages=1-5')).toEqual({ type: 'unknown_unit' });
  });

  it('hex values bytes=0x10-20 → invalid', () => {
    expect(parseRangeHeader('bytes=0x10-20')).toEqual({ type: 'invalid' });
  });

  it('scientific notation bytes=1e3-2000 → invalid', () => {
    expect(parseRangeHeader('bytes=1e3-2000')).toEqual({ type: 'invalid' });
  });

  it('whitespace inside range spec bytes=0 -1 → invalid', () => {
    expect(parseRangeHeader('bytes=0 -1')).toEqual({ type: 'invalid' });
  });

  it('leading zeros bytes=00001-2 → valid range', () => {
    // Leading zeros are valid decimal; parseInt handles them
    expect(parseRangeHeader('bytes=00001-2')).toEqual({ type: 'range', start: 1, end: 2 });
  });

  it('bare hyphen bytes=- → invalid', () => {
    expect(parseRangeHeader('bytes=-')).toEqual({ type: 'invalid' });
  });

  it('overflow number → invalid', () => {
    expect(parseRangeHeader('bytes=99999999999999999999-')).toEqual({ type: 'invalid' });
  });
});

describe('resolveRange', () => {
  it('resolves a closed range', () => {
    const parsed = parseRangeHeader('bytes=0-99');
    expect(resolveRange(parsed, 1000)).toEqual({ start: 0, end: 99 });
  });

  it('clamps end to file size', () => {
    const parsed = parseRangeHeader('bytes=0-9999');
    expect(resolveRange(parsed, 100)).toEqual({ start: 0, end: 99 });
  });

  it('resolves open-ended range', () => {
    const parsed = parseRangeHeader('bytes=50-');
    expect(resolveRange(parsed, 100)).toEqual({ start: 50, end: 99 });
  });

  it('resolves suffix range', () => {
    const parsed = parseRangeHeader('bytes=-20');
    expect(resolveRange(parsed, 100)).toEqual({ start: 80, end: 99 });
  });

  it('returns null for start past end of file', () => {
    const parsed = parseRangeHeader('bytes=200-300');
    expect(resolveRange(parsed, 100)).toBeNull();
  });

  it('returns null for none type', () => {
    expect(resolveRange({ type: 'none' }, 100)).toBeNull();
  });

  it('suffix range on zero-length file → null (M11)', () => {
    const parsed = parseRangeHeader('bytes=-50');
    expect(resolveRange(parsed, 0)).toBeNull();
  });

  it('unknown_unit → null (delivered as 200 full by controller)', () => {
    expect(resolveRange({ type: 'unknown_unit' }, 100)).toBeNull();
  });
});
