/**
 * Tests that library and saved query keys include the locale (C-28, CLI-R-13).
 *
 * Switching language must produce a different query key so TanStack Query
 * refetches instead of serving stale translated content.
 */
import { describe, it, expect } from 'vitest';
import { libraryKeys, savedKeys } from '@nestself/api-client';
import type { ActiveContext } from '@nestself/contracts';

const ctx: ActiveContext = { kind: 'personal', orgId: 'org_a' };

describe('Library query keys include locale', () => {
  it('contentList key changes with locale', () => {
    const keyEn = libraryKeys.contentList(ctx, 'en');
    const keySr = libraryKeys.contentList(ctx, 'sr-Latn');
    expect(keyEn).not.toEqual(keySr);
    expect(keyEn).toContain('en');
    expect(keySr).toContain('sr-Latn');
  });

  it('contentDetail key includes locale', () => {
    const keyEn = libraryKeys.contentDetail(ctx, 'res_1', 'en');
    const keyHu = libraryKeys.contentDetail(ctx, 'res_1', 'hu');
    expect(keyEn).not.toEqual(keyHu);
    expect(keyEn).toContain('en');
    expect(keyHu).toContain('hu');
  });

  it('home key includes locale', () => {
    const keyEn = libraryKeys.home(ctx, 'en');
    const keySr = libraryKeys.home(ctx, 'sr-Latn');
    expect(keyEn).not.toEqual(keySr);
  });

  it('saved list key includes locale', () => {
    const keyEn = savedKeys.list(ctx, 'en');
    const keyHu = savedKeys.list(ctx, 'hu');
    expect(keyEn).not.toEqual(keyHu);
  });
});
