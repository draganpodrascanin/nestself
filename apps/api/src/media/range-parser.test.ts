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

  it('returns invalid for non-bytes unit', () => {
    expect(parseRangeHeader('chars=0-10')).toEqual({ type: 'invalid' });
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
});
