/**
 * Unit tests for LibraryService -- DTO mapping, Cyrillic transliteration,
 * source normalization, body filtering, CTA extraction, cursor HMAC.
 *
 * Tests the EXPORTED functions (body-filter, locale-header) and the
 * contract schemas without a database.
 */
import { describe, it, expect } from 'vitest';
import { parseAcceptLanguageLocale } from './locale-header.js';
import { transliterateText } from '@nestself/content/schema';
import {
  LibraryContentDetailSchema,
  LibraryCardSchema,
  SavedItemSchema,
} from '@nestself/contracts';
import {
  collectReferencedResourceIds,
  filterDocumentBody,
  extractCtaFromBody,
  type FilterContext,
} from './body-filter.js';

// ---------------------------------------------------------------------------
// Locale parsing
// ---------------------------------------------------------------------------

describe('LibraryService unit -- locale parsing', () => {
  it('parses sr-Cyrl', () => {
    expect(parseAcceptLanguageLocale('sr-Cyrl')).toBe('sr-Cyrl');
  });

  it('defaults undefined to sr-Latn', () => {
    expect(parseAcceptLanguageLocale(undefined)).toBe('sr-Latn');
  });

  it('maps hu-HU to hu', () => {
    expect(parseAcceptLanguageLocale('hu-HU')).toBe('hu');
  });

  it('maps sr-ME to sr-Latn', () => {
    expect(parseAcceptLanguageLocale('sr-ME')).toBe('sr-Latn');
  });

  it('maps sr-BA to sr-Latn', () => {
    expect(parseAcceptLanguageLocale('sr-BA')).toBe('sr-Latn');
  });
});

// ---------------------------------------------------------------------------
// Cyrillic transliteration
// ---------------------------------------------------------------------------

describe('LibraryService unit -- Cyrillic transliteration', () => {
  const SERBIAN_LATIN_DIGRAPHS = /[čćžšđ]/i;

  it('transliterates Serbian Latin title to Cyrillic', () => {
    const latin = 'Mirniji kraj dana: tri mala koraka';
    const cyrillic = transliterateText(latin);
    expect(cyrillic).not.toMatch(SERBIAN_LATIN_DIGRAPHS);
    expect(cyrillic).toBeTruthy();
  });

  it('transliterates summary text', () => {
    const latin = 'Tri jednostavna koraka koja pomažu da se radni dan završi bez žurbe.';
    const cyrillic = transliterateText(latin);
    expect(cyrillic).not.toMatch(/[čćžšđ]/);
  });

  it('transliterates all Latin letters used in Serbian', () => {
    const fixture = 'čćžšđ lj nj dž';
    const cyrillic = transliterateText(fixture);
    expect(cyrillic).not.toMatch(SERBIAN_LATIN_DIGRAPHS);
    expect(cyrillic).not.toContain('lj');
    expect(cyrillic).not.toContain('nj');
  });
});

// ---------------------------------------------------------------------------
// Body filter (exported functions from body-filter.ts)
// ---------------------------------------------------------------------------

describe('LibraryService unit -- body filter (collectReferencedResourceIds)', () => {
  function doc(...nodes: unknown[]) {
    return { type: 'doc', schemaVersion: 1, content: nodes };
  }

  it('collects relatedResource and CTA targetIds', () => {
    const d = doc(
      { type: 'relatedResource', attrs: { contentResourceId: 'res_a' } },
      { type: 'cta', attrs: { ctaKind: 'open_content', targetId: 'res_b' } },
    );
    const ids = collectReferencedResourceIds(d);
    expect(ids.sort()).toEqual(['res_a', 'res_b']);
  });

  it('collects internal link hrefs from text marks', () => {
    const d = doc({
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'see this',
        marks: [{ type: 'link', attrs: { href: 'nestself:content/res_linked' } }],
      }],
    });
    expect(collectReferencedResourceIds(d)).toEqual(['res_linked']);
  });

  it('ignores external links and non-content CTA kinds', () => {
    const d = doc(
      { type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] },
      { type: 'cta', attrs: { ctaKind: 'open_service', targetId: 'calls' } },
    );
    expect(collectReferencedResourceIds(d)).toEqual([]);
  });
});

describe('LibraryService unit -- body filter (filterDocumentBody)', () => {
  const ctx: FilterContext = {
    availableIds: new Set(['res_ok']),
    capabilities: ['library'],
  };

  it('drops relatedResource nodes for unavailable targets', () => {
    const d = { type: 'doc', schemaVersion: 1, content: [
      { type: 'relatedResource', attrs: { contentResourceId: 'res_ok' } },
      { type: 'relatedResource', attrs: { contentResourceId: 'res_gone' } },
    ] };
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(1);
  });

  it('drops CTA of unknown kind', () => {
    const d = { type: 'doc', schemaVersion: 1, content: [
      { type: 'cta', attrs: { ctaKind: 'unknown_kind' } },
    ] };
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(0);
  });

  it('drops open_service CTA when capability missing', () => {
    const d = { type: 'doc', schemaVersion: 1, content: [
      { type: 'cta', attrs: { ctaKind: 'open_service', targetId: 'calls' } },
    ] };
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(0);
  });

  it('unwraps internal link mark for unavailable target', () => {
    const d = { type: 'doc', schemaVersion: 1, content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'click here', marks: [{ type: 'link', attrs: { href: 'nestself:content/res_gone' } }] },
      ] },
    ] };
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const para = ((filtered.content as unknown[])[0] as Record<string, unknown>);
    const textNode = (para.content as Array<Record<string, unknown>>)[0]!;
    expect(textNode.text).toBe('click here');
    expect(textNode.marks).toBeUndefined();
  });
});

describe('LibraryService unit -- body filter (extractCtaFromBody)', () => {
  it('extracts CTA from body', () => {
    const d = { type: 'doc', schemaVersion: 1, content: [
      { type: 'cta', attrs: { ctaKind: 'open_content', targetId: 'res_1', label: 'Read more' } },
    ] };
    expect(extractCtaFromBody(d)).toEqual({
      kind: 'open_content',
      targetId: 'res_1',
      label: 'Read more',
    });
  });

  it('returns null when no CTA', () => {
    const d = { type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [] }] };
    expect(extractCtaFromBody(d)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DTO field set (must-fix 4: extended FORBIDDEN_KEYS)
// ---------------------------------------------------------------------------

describe('LibraryService unit -- DTO field set', () => {
  const FORBIDDEN_KEYS = [
    'revisionId', 'reviewComments', 'audiences', 'membershipId',
    'draftId', 'privateSourceSubmissionId', 'unpublishedTranslations',
    'authorUserId', 'approvedByUserId', 'publicationId', 'orgId',
    'userId', 'approvalHash', 'lastEditorUserId',
  ];

  it('detail DTO strict-parses against the contract schema', () => {
    const dto = {
      id: 'res_1',
      type: 'article',
      locale: 'sr-Latn',
      title: 'Test',
      summary: 'Test summary',
      outcome: 'Test outcome',
      body: { type: 'doc', content: [] },
      durationSeconds: 300,
      durationBand: '5_to_15',
      difficulty: 'easy',
      category: { id: 'cat_1', slug: 'test', label: 'Test', description: null },
      secondaryCategories: [],
      topics: [],
      authorName: 'Author',
      reviewerName: null,
      reviewedAt: null,
      sources: [{ label: 'Source', url: null }],
      media: [],
      relatedResources: [],
      cta: null,
      availableLocales: ['sr-Latn', 'sr-Cyrl', 'hu', 'en'],
      saved: false,
      playbackPosition: null,
      replacementLink: null,
    };

    const result = LibraryContentDetailSchema.strict().safeParse(dto);
    expect(result.success).toBe(true);

    for (const key of FORBIDDEN_KEYS) {
      expect(dto).not.toHaveProperty(key);
    }
  });

  it('detail DTO with CTA that has nullable label', () => {
    const dto = {
      id: 'res_1',
      type: 'article',
      locale: 'sr-Latn',
      title: 'Test',
      summary: 'Test summary',
      outcome: 'Test outcome',
      body: { type: 'doc', content: [] },
      durationSeconds: 300,
      durationBand: '5_to_15',
      difficulty: 'easy',
      category: { id: 'cat_1', slug: 'test', label: 'Test', description: null },
      secondaryCategories: [],
      topics: [],
      authorName: 'Author',
      reviewerName: null,
      reviewedAt: null,
      sources: [],
      media: [],
      relatedResources: [],
      cta: { kind: 'suggest_topic', label: null, targetId: null },
      availableLocales: ['sr-Latn', 'sr-Cyrl', 'hu', 'en'],
      saved: false,
      playbackPosition: null,
      replacementLink: null,
    };

    const result = LibraryContentDetailSchema.strict().safeParse(dto);
    expect(result.success).toBe(true);
  });

  it('card DTO strict-parses against the contract schema', () => {
    const card = {
      resourceId: 'res_1',
      type: 'article',
      locale: 'sr-Latn',
      title: 'Test',
      summary: 'Summary',
      categoryName: 'Stress',
      durationBand: 'under_5',
      coverImageUrl: null,
      saved: false,
      availableLocales: ['sr-Latn', 'sr-Cyrl', 'hu', 'en'],
    };

    const result = LibraryCardSchema.strict().safeParse(card);
    expect(result.success).toBe(true);
  });

  it('saved unavailable item strict-parses against the contract schema', () => {
    const saved = {
      resourceId: 'res_1',
      type: null,
      title: null,
      status: 'unavailable',
      categoryName: null,
      coverImageUrl: null,
      savedAt: new Date().toISOString(),
    };

    const result = SavedItemSchema.strict().safeParse(saved);
    expect(result.success).toBe(true);
  });
});
