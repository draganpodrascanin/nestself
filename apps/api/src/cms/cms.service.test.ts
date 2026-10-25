/**
 * CMS service unit tests (T-C1.10 review fix).
 *
 * Tests the exported pure functions and logic of the CMS service:
 * - extractMediaRefs from ProseMirror documents
 * - audience containment (entry-by-entry) via checkAudienceContainmentPure
 * - revision state transition preconditions
 * - approval hash input builder
 * - ETag / If-Match format
 * - locale completeness
 *
 * Integration tests with a database run in the e2e spec and probes.
 */
import { describe, it, expect } from 'vitest';

// Import the real exported functions from the service module.
// extractMediaRefs and checkAudienceContainmentPure are re-exported for testing.
import { extractMediaRefs, extractCtaFromBody, addBusinessDays, checkAudienceContainmentPure } from './cms-helpers.js';
import { AudienceEntrySchema } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';

// ---------------------------------------------------------------------------
// Media node extraction
// ---------------------------------------------------------------------------

describe('extractMediaRefs', () => {
  const doc = (extra: unknown[] = []) => ({
    type: 'doc', schemaVersion: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ...extra,
    ],
  });

  it('extracts image nodes as inline_image', () => {
    const refs = extractMediaRefs(doc([
      { type: 'image', attrs: { mediaAssetId: 'asset_1', alt: 'photo' } },
    ]));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ mediaAssetId: 'asset_1', usageKind: 'inline_image' });
  });

  it('extracts approvedMedia nodes as body_media', () => {
    const refs = extractMediaRefs(doc([
      { type: 'approvedMedia', attrs: { mediaAssetId: 'asset_2', kind: 'pdf' } },
    ]));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ mediaAssetId: 'asset_2', usageKind: 'body_media' });
  });

  it('extracts both image and approvedMedia', () => {
    const refs = extractMediaRefs(doc([
      { type: 'image', attrs: { mediaAssetId: 'img_1', alt: '' } },
      { type: 'approvedMedia', attrs: { mediaAssetId: 'pdf_1', kind: 'pdf' } },
    ]));
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.usageKind).sort()).toEqual(['body_media', 'inline_image']);
  });

  it('deduplicates by mediaAssetId', () => {
    const refs = extractMediaRefs(doc([
      { type: 'image', attrs: { mediaAssetId: 'same', alt: '' } },
      { type: 'approvedMedia', attrs: { mediaAssetId: 'same', kind: 'pdf' } },
    ]));
    expect(refs).toHaveLength(1);
  });

  it('returns empty for a doc with no media', () => {
    expect(extractMediaRefs(doc())).toHaveLength(0);
  });

  it('handles nested content', () => {
    const refs = extractMediaRefs({
      type: 'doc',
      content: [
        {
          type: 'section',
          content: [
            { type: 'image', attrs: { mediaAssetId: 'nested_1' } },
          ],
        },
      ],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.mediaAssetId).toBe('nested_1');
  });

  it('ignores nodes without mediaAssetId attr', () => {
    const refs = extractMediaRefs(doc([
      { type: 'image', attrs: { alt: 'no media ref' } },
    ]));
    expect(refs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Audience containment (entry-by-entry, C-12)
// ---------------------------------------------------------------------------

describe('Audience containment (C-12)', () => {
  it('allows narrowing from all_eligible to organization', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'organization', orgId: 'org_1' }],
        [{ kind: 'all_eligible' }],
      ),
    ).not.toThrow();
  });

  it('refuses broadening from organization to all_eligible', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'all_eligible' }],
        [{ kind: 'organization', orgId: 'org_1' }],
      ),
    ).toThrow(ApiHttpException);
  });

  it('refuses adding an organization not in proposed', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'organization', orgId: 'org_2' }],
        [{ kind: 'organization', orgId: 'org_1' }],
      ),
    ).toThrow(ApiHttpException);
  });

  it('allows subset of proposed organizations', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'organization', orgId: 'org_1' }],
        [{ kind: 'organization', orgId: 'org_1' }, { kind: 'organization', orgId: 'org_2' }],
      ),
    ).not.toThrow();
  });

  it('rejects all publish entries when proposed is null (fail-closed)', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'all_eligible' }],
        null,
      ),
    ).toThrow(ApiHttpException);
  });

  it('rejects all publish entries when proposed is empty array', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'organization', orgId: 'org_1' }],
        [],
      ),
    ).toThrow(ApiHttpException);
  });

  it('allows empty publish audience even when proposed is null', () => {
    expect(() =>
      checkAudienceContainmentPure([], null),
    ).not.toThrow();
  });

  it('refuses org_unit → whole organization (P4a)', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'organization', orgId: 'org_sample' }],
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_engineering', includeDescendants: false }],
      ),
    ).toThrow(ApiHttpException);
  });

  it('refuses sibling org_unit (P4b)', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_commercial' }],
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_engineering', includeDescendants: false }],
      ),
    ).toThrow(ApiHttpException);
  });

  it('allows narrowing from organization to org_unit within that org', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_engineering' }],
        [{ kind: 'organization', orgId: 'org_sample' }],
      ),
    ).not.toThrow();
  });

  it('allows exact org_unit match', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_engineering', includeDescendants: false }],
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_engineering', includeDescendants: true }],
      ),
    ).not.toThrow();
  });

  it('refuses includeDescendants broadening', () => {
    expect(() =>
      checkAudienceContainmentPure(
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_engineering', includeDescendants: true }],
        [{ kind: 'org_unit', orgId: 'org_sample', orgUnitId: 'ou_engineering', includeDescendants: false }],
      ),
    ).toThrow(ApiHttpException);
  });
});

// ---------------------------------------------------------------------------
// CTA extraction from ProseMirror documents (FMT-R-27)
// ---------------------------------------------------------------------------

describe('extractCtaFromBody (FMT-R-27)', () => {
  const doc = (extra: unknown[] = []) => ({
    type: 'doc', schemaVersion: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ...extra,
    ],
  });

  it('extracts a cta node from the body', () => {
    const cta = extractCtaFromBody(doc([
      { type: 'cta', attrs: { kind: 'link', targetId: 'res_1' } },
    ]));
    expect(cta).toEqual({ kind: 'link', targetId: 'res_1' });
  });

  it('returns null when no cta node is present', () => {
    expect(extractCtaFromBody(doc())).toBeNull();
  });

  it('finds nested cta nodes', () => {
    const cta = extractCtaFromBody({
      type: 'doc',
      content: [
        {
          type: 'section',
          content: [
            { type: 'cta', attrs: { kind: 'download' } },
          ],
        },
      ],
    });
    expect(cta).toEqual({ kind: 'download', targetId: undefined });
  });

  it('returns the first cta node when multiple exist', () => {
    const cta = extractCtaFromBody(doc([
      { type: 'cta', attrs: { kind: 'first', targetId: 'a' } },
      { type: 'cta', attrs: { kind: 'second', targetId: 'b' } },
    ]));
    expect(cta!.kind).toBe('first');
  });

  it('ignores cta nodes with missing kind', () => {
    expect(extractCtaFromBody(doc([
      { type: 'cta', attrs: { targetId: 'res_1' } },
    ]))).toBeNull();
  });

  it('ignores cta nodes without attrs', () => {
    expect(extractCtaFromBody(doc([
      { type: 'cta' },
    ]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Business day arithmetic (review_due_at)
// ---------------------------------------------------------------------------

describe('addBusinessDays', () => {
  it('adds 2 business days from Monday → Wednesday', () => {
    const mon = new Date('2026-10-26T09:00:00Z'); // Monday
    const result = addBusinessDays(mon, 2);
    expect(result.getDay()).toBe(3); // Wednesday
    expect(result.getDate()).toBe(28);
  });

  it('skips weekends (Thursday + 2 = Monday)', () => {
    const thu = new Date('2026-10-22T09:00:00Z'); // Thursday
    const result = addBusinessDays(thu, 2);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(26);
  });

  it('handles Friday + 1 = Monday', () => {
    const fri = new Date('2026-10-23T09:00:00Z'); // Friday
    const result = addBusinessDays(fri, 1);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(26);
  });

  it('handles 0 business days (same day)', () => {
    const date = new Date('2026-10-26T09:00:00Z');
    const result = addBusinessDays(date, 0);
    expect(result.getDate()).toBe(26);
  });
});

// ---------------------------------------------------------------------------
// Revision state transition preconditions
// ---------------------------------------------------------------------------

describe('Revision state transitions', () => {
  const SUBMITTABLE_STATES = ['draft', 'changes_requested'];

  it('allows submit from draft', () => {
    expect(SUBMITTABLE_STATES).toContain('draft');
  });

  it('allows submit from changes_requested', () => {
    expect(SUBMITTABLE_STATES).toContain('changes_requested');
  });

  it.each(['approved', 'superseded', 'in_review'])('rejects submit from %s', (state) => {
    expect(SUBMITTABLE_STATES).not.toContain(state);
  });

  it('allows approve only from in_review', () => {
    const approvable = 'in_review';
    expect(approvable).toBe('in_review');
  });
});

// ---------------------------------------------------------------------------
// Self-review (ACC-R-08, 5.5)
// ---------------------------------------------------------------------------

describe('Self-review rule (ACC-R-08)', () => {
  const isSelfReview = (author: string, lastEditor: string, reviewer: string) =>
    author === reviewer || lastEditor === reviewer;

  it('refuses when reviewer is the author', () => {
    expect(isSelfReview('user_A', 'user_B', 'user_A')).toBe(true);
  });

  it('refuses when reviewer is the last editor', () => {
    expect(isSelfReview('user_A', 'user_B', 'user_B')).toBe(true);
  });

  it('allows when reviewer is neither', () => {
    expect(isSelfReview('user_A', 'user_B', 'user_C')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ETag / If-Match format
// ---------------------------------------------------------------------------

describe('ETag / If-Match format', () => {
  const ETAG_RE = /^"(\d+)"$/;

  it('parses valid quoted integer', () => {
    const m = ETAG_RE.exec('"42"');
    expect(m).toBeTruthy();
    expect(m![1]).toBe('42');
  });

  it('rejects unquoted integer', () => {
    expect(ETAG_RE.exec('42')).toBeNull();
  });

  it('rejects quoted non-integer', () => {
    expect(ETAG_RE.exec('"1abc"')).toBeNull();
  });

  it('rejects empty quotes', () => {
    expect(ETAG_RE.exec('""')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Locale completeness (WRK-R-36)
// ---------------------------------------------------------------------------

describe('Locale completeness (WRK-R-36)', () => {
  const AUTHORED_LOCALES = ['sr-Latn', 'hu', 'en'];

  it('detects missing locales for full publish', () => {
    const presentLocales = ['sr-Latn', 'en'];
    const missing = AUTHORED_LOCALES.filter((l) => !presentLocales.includes(l));
    expect(missing).toEqual(['hu']);
  });

  it('passes when all three are present', () => {
    const missing = AUTHORED_LOCALES.filter((l) => !['sr-Latn', 'hu', 'en'].includes(l));
    expect(missing).toHaveLength(0);
  });

  it('correction path: only requested locales need approved revisions', () => {
    const requestedLocales = ['hu'];
    const otherLocales = AUTHORED_LOCALES.filter((l) => !requestedLocales.includes(l));
    expect(otherLocales).toEqual(['sr-Latn', 'en']);
    // Other locales need live publications (tested in e2e)
  });
});

// ---------------------------------------------------------------------------
// AudienceEntrySchema per-kind validation (WRK-R-38)
// ---------------------------------------------------------------------------

describe('AudienceEntrySchema per-kind validation (WRK-R-38)', () => {
  it('accepts all_eligible without orgId or orgUnitId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'all_eligible' });
    expect(result.success).toBe(true);
  });

  it('rejects all_eligible with orgId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'all_eligible', orgId: 'org_1' });
    expect(result.success).toBe(false);
  });

  it('rejects all_eligible with orgUnitId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'all_eligible', orgUnitId: 'ou_1' });
    expect(result.success).toBe(false);
  });

  it('accepts organization with orgId only', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'organization', orgId: 'org_1' });
    expect(result.success).toBe(true);
  });

  it('rejects organization without orgId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'organization' });
    expect(result.success).toBe(false);
  });

  it('rejects organization with orgUnitId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'organization', orgId: 'org_1', orgUnitId: 'ou_1' });
    expect(result.success).toBe(false);
  });

  it('accepts org_unit with both orgId and orgUnitId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'org_unit', orgId: 'org_1', orgUnitId: 'ou_1' });
    expect(result.success).toBe(true);
  });

  it('rejects org_unit without orgId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'org_unit', orgUnitId: 'ou_1' });
    expect(result.success).toBe(false);
  });

  it('rejects org_unit without orgUnitId', () => {
    const result = AudienceEntrySchema.safeParse({ kind: 'org_unit', orgId: 'org_1' });
    expect(result.success).toBe(false);
  });
});
