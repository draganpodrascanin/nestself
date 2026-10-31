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

  it('extracts a cta node from the body (ctaKind attr)', () => {
    const cta = extractCtaFromBody(doc([
      { type: 'cta', attrs: { ctaKind: 'open_content', targetId: 'res_1' } },
    ]));
    expect(cta).toEqual({ kind: 'open_content', targetId: 'res_1' });
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
            { type: 'cta', attrs: { ctaKind: 'suggest_topic' } },
          ],
        },
      ],
    });
    expect(cta).toEqual({ kind: 'suggest_topic', targetId: undefined });
  });

  it('returns the first cta node when multiple exist', () => {
    const cta = extractCtaFromBody(doc([
      { type: 'cta', attrs: { ctaKind: 'open_content', targetId: 'a' } },
      { type: 'cta', attrs: { ctaKind: 'open_collection', targetId: 'b' } },
    ]));
    expect(cta!.kind).toBe('open_content');
  });

  it('ignores cta nodes with missing ctaKind', () => {
    expect(extractCtaFromBody(doc([
      { type: 'cta', attrs: { targetId: 'res_1' } },
    ]))).toBeNull();
  });

  it('ignores cta nodes without attrs', () => {
    expect(extractCtaFromBody(doc([
      { type: 'cta' },
    ]))).toBeNull();
  });

  it('ignores cta nodes with old "kind" attr (schema uses ctaKind)', () => {
    expect(extractCtaFromBody(doc([
      { type: 'cta', attrs: { kind: 'link', targetId: 'res_1' } },
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

// Tautological state-transition, self-review, ETag, and locale tests
// removed — they tested local constants, not the service.  State
// transitions, self-review, ETag parsing and locale completeness are
// covered by the e2e specs (cms.e2e, cms-workflow.e2e).

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
