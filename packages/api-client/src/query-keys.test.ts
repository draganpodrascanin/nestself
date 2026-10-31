import { describe, it, expect } from 'vitest';
import type { ActiveContext } from '@nestself/contracts';
import {
  contextKey,
  libraryKeys,
  savedKeys,
  requestKeys,
  questionKeys,
  cmsKeys,
  mediaKeys,
  pollKeys,
  intakeKeys,
  reportingKeys,
} from './query-keys';

describe('contextKey', () => {
  it('returns personal with orgId', () => {
    const ctx: ActiveContext = { kind: 'personal', orgId: 'org_a' };
    expect(contextKey(ctx)).toEqual(['ctx', 'personal', 'org_a']);
  });

  it('returns personal without orgId', () => {
    const ctx: ActiveContext = { kind: 'personal' };
    expect(contextKey(ctx)).toEqual(['ctx', 'personal']);
  });

  it('returns organization context', () => {
    const ctx: ActiveContext = { kind: 'organization', orgId: 'org_a' };
    expect(contextKey(ctx)).toEqual(['ctx', 'organization', 'org_a']);
  });

  it('returns expert context', () => {
    const ctx: ActiveContext = { kind: 'expert' };
    expect(contextKey(ctx)).toEqual(['ctx', 'expert']);
  });

  it('returns operations context', () => {
    const ctx: ActiveContext = { kind: 'operations' };
    expect(contextKey(ctx)).toEqual(['ctx', 'operations']);
  });

  it('produces distinct keys for personal vs organization in same org', () => {
    const personal = contextKey({ kind: 'personal', orgId: 'org_a' });
    const org = contextKey({ kind: 'organization', orgId: 'org_a' });
    expect(personal).not.toEqual(org);
  });
});

describe('libraryKeys', () => {
  const ctx: ActiveContext = { kind: 'personal', orgId: 'org_b' };

  it('.all starts with contextKey', () => {
    const key = libraryKeys.all(ctx);
    expect(key.slice(0, 3)).toEqual(contextKey(ctx));
    expect(key).toEqual(['ctx', 'personal', 'org_b', 'library']);
  });

  it('.home includes the locale', () => {
    const key = libraryKeys.home(ctx, 'sr-Latn');
    expect(key).toEqual(['ctx', 'personal', 'org_b', 'library', 'home', 'sr-Latn']);
  });

  it('.contentDetail includes the content id and locale', () => {
    const key = libraryKeys.contentDetail(ctx, 'c-123', 'en');
    expect(key).toEqual([
      'ctx', 'personal', 'org_b', 'library', 'content', 'c-123', 'en',
    ]);
  });

  it('.contentList includes the locale', () => {
    const key = libraryKeys.contentList(ctx, 'hu');
    expect(key).toEqual([
      'ctx', 'personal', 'org_b', 'library', 'content', 'list', 'hu',
    ]);
  });
});

describe('savedKeys', () => {
  const ctx: ActiveContext = { kind: 'organization', orgId: 'org_c' };

  it('.all starts with contextKey', () => {
    expect(savedKeys.all(ctx)).toEqual(['ctx', 'organization', 'org_c', 'me', 'saved']);
  });

  it('.list includes locale', () => {
    expect(savedKeys.list(ctx, 'en')).toEqual([
      'ctx', 'organization', 'org_c', 'me', 'saved', 'en',
    ]);
  });
});

describe('remaining key factories have .all root', () => {
  const ctx: ActiveContext = { kind: 'expert' };

  it.each([
    ['requestKeys', requestKeys],
    ['questionKeys', questionKeys],
    ['cmsKeys', cmsKeys],
    ['mediaKeys', mediaKeys],
    ['pollKeys', pollKeys],
    ['intakeKeys', intakeKeys],
    ['reportingKeys', reportingKeys],
  ])('%s.all starts with contextKey', (_name, factory) => {
    const key = factory.all(ctx);
    expect(key.slice(0, 2)).toEqual(contextKey(ctx));
    expect(key.length).toBeGreaterThan(2);
  });
});
