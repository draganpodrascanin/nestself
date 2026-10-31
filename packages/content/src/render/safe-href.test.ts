/**
 * Tests for the safe-href utility used by the renderer (defense-in-depth, 6.9).
 */
import { describe, expect, it } from 'vitest';

import { isSafeHref, isInternalHref, extractContentId } from './safe-href.ts';

describe('isSafeHref', () => {
  it('accepts https:// URLs', () => {
    expect(isSafeHref('https://example.com/page')).toBe(true);
    expect(isSafeHref('https://example.com')).toBe(true);
  });

  it('accepts internal nestself:content/ links', () => {
    expect(isSafeHref('nestself:content/abc-123')).toBe(true);
  });

  it('rejects javascript: protocol', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: protocol', () => {
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects http: protocol', () => {
    expect(isSafeHref('http://example.com')).toBe(false);
  });

  it('rejects protocol-relative URLs', () => {
    expect(isSafeHref('//evil.com/payload')).toBe(false);
  });

  it('rejects https: without double slash (T-C1.06 hardening a)', () => {
    expect(isSafeHref('https:allowed.example')).toBe(false);
  });

  it('rejects non-ASCII characters (T-C1.06 hardening b)', () => {
    expect(isSafeHref('https://сajt.example.com')).toBe(false);
  });

  it('rejects zero-width space in host', () => {
    expect(isSafeHref('https://example​.com')).toBe(false);
  });

  it('rejects URLs with userinfo', () => {
    expect(isSafeHref('https://user:pass@example.com')).toBe(false);
  });

  it('rejects URLs with non-default port', () => {
    expect(isSafeHref('https://example.com:8080')).toBe(false);
  });
});

describe('isInternalHref', () => {
  it('returns true for internal links', () => {
    expect(isInternalHref('nestself:content/abc-123')).toBe(true);
  });

  it('returns false for external links', () => {
    expect(isInternalHref('https://example.com')).toBe(false);
  });
});

describe('extractContentId', () => {
  it('extracts the id from an internal href', () => {
    expect(extractContentId('nestself:content/abc-123')).toBe('abc-123');
  });

  it('returns null for non-internal hrefs', () => {
    expect(extractContentId('https://example.com')).toBeNull();
  });
});
