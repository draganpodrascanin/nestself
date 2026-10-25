/**
 * Unit tests for the body document filter (FMT-R-05, LIB-R-23, ACC-R-22).
 */
import { describe, it, expect } from 'vitest';
import {
  collectReferencedResourceIds,
  filterDocumentBody,
  extractCtaFromBody,
  type FilterContext,
} from './body-filter.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function doc(...nodes: unknown[]) {
  return { type: 'doc', schemaVersion: 1, content: nodes };
}

function text(t: string, marks?: unknown[]) {
  return marks ? { type: 'text', text: t, marks } : { type: 'text', text: t };
}

function paragraph(...nodes: unknown[]) {
  return { type: 'paragraph', content: nodes };
}

function relatedResource(id: string) {
  return { type: 'relatedResource', attrs: { contentResourceId: id } };
}

function cta(kind: string, targetId?: string | null, label?: string | null) {
  const attrs: Record<string, unknown> = { ctaKind: kind };
  if (targetId !== undefined) attrs.targetId = targetId;
  if (label !== undefined) attrs.label = label;
  return { type: 'cta', attrs };
}

function internalLink(id: string) {
  return { type: 'link', attrs: { href: `nestself:content/${id}` } };
}

function externalLink(url: string) {
  return { type: 'link', attrs: { href: url } };
}

// ---------------------------------------------------------------------------
// collectReferencedResourceIds
// ---------------------------------------------------------------------------

describe('collectReferencedResourceIds', () => {
  it('collects relatedResource contentResourceId', () => {
    const d = doc(
      paragraph(text('hello')),
      relatedResource('res_a'),
      relatedResource('res_b'),
    );
    const ids = collectReferencedResourceIds(d);
    expect(ids).toEqual(expect.arrayContaining(['res_a', 'res_b']));
    expect(ids).toHaveLength(2);
  });

  it('collects CTA targetId for content-targeting kinds', () => {
    const d = doc(cta('open_content', 'res_target'));
    const ids = collectReferencedResourceIds(d);
    expect(ids).toContain('res_target');
  });

  it('does not collect CTA targetId for non-content kinds', () => {
    const d = doc(cta('open_service', 'library'));
    const ids = collectReferencedResourceIds(d);
    expect(ids).toHaveLength(0);
  });

  it('collects internal link hrefs from text marks', () => {
    const d = doc(
      paragraph(
        text('see also ', []),
        text('this article', [internalLink('res_linked')]),
        text(' for more.'),
      ),
    );
    const ids = collectReferencedResourceIds(d);
    expect(ids).toContain('res_linked');
  });

  it('does not collect external links', () => {
    const d = doc(
      paragraph(text('visit', [externalLink('https://example.com')])),
    );
    const ids = collectReferencedResourceIds(d);
    expect(ids).toHaveLength(0);
  });

  it('deduplicates ids', () => {
    const d = doc(
      relatedResource('res_a'),
      paragraph(text('link', [internalLink('res_a')])),
    );
    const ids = collectReferencedResourceIds(d);
    expect(ids).toEqual(['res_a']);
  });

  it('returns empty for a doc with no references', () => {
    const d = doc(paragraph(text('plain text')));
    expect(collectReferencedResourceIds(d)).toEqual([]);
  });

  it('handles null/undefined gracefully', () => {
    expect(collectReferencedResourceIds(null)).toEqual([]);
    expect(collectReferencedResourceIds(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterDocumentBody
// ---------------------------------------------------------------------------

describe('filterDocumentBody', () => {
  const ctx: FilterContext = {
    availableIds: new Set(['res_available']),
    capabilities: ['library'],
  };

  it('drops relatedResource nodes for unavailable targets', () => {
    const d = doc(
      relatedResource('res_available'),
      relatedResource('res_gone'),
    );
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const content = filtered.content as unknown[];
    expect(content).toHaveLength(1);
    expect((content[0] as Record<string, unknown>).type).toBe('relatedResource');
  });

  it('drops CTA node for unavailable content target', () => {
    const d = doc(cta('open_content', 'res_gone'));
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(0);
  });

  it('keeps CTA node for available content target', () => {
    const d = doc(cta('open_content', 'res_available'));
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(1);
  });

  it('drops CTA of unknown kind', () => {
    const d = doc(cta('unknown_kind', null));
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(0);
  });

  it('drops open_service CTA when capability is missing', () => {
    const noCap: FilterContext = {
      availableIds: new Set(),
      capabilities: ['library'],
    };
    const d = doc(cta('open_service', 'calls'));
    const filtered = filterDocumentBody(d, noCap) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(0);
  });

  it('keeps open_service CTA when capability is present', () => {
    const withCap: FilterContext = {
      availableIds: new Set(),
      capabilities: ['library', 'calls'],
    };
    const d = doc(cta('open_service', 'calls'));
    const filtered = filterDocumentBody(d, withCap) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(1);
  });

  it('keeps suggest_topic CTA regardless of availability', () => {
    const d = doc(cta('suggest_topic', null));
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    expect((filtered.content as unknown[]).length).toBe(1);
  });

  it('unwraps internal link marks for unavailable targets, keeping text', () => {
    const d = doc(
      paragraph(
        text('Read ', []),
        text('this', [internalLink('res_gone')]),
        text(' too.'),
      ),
    );
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const para = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const nodes = para.content as Array<Record<string, unknown>>;
    // The text 'this' should still exist but without the link mark
    const linkText = nodes.find((n) => n.text === 'this');
    expect(linkText).toBeTruthy();
    expect(linkText!.marks).toBeUndefined(); // marks removed
  });

  it('keeps external link marks unchanged', () => {
    const d = doc(
      paragraph(text('visit', [externalLink('https://example.com')])),
    );
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const para = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const nodes = para.content as Array<Record<string, unknown>>;
    const linkText = nodes[0] as Record<string, unknown>;
    expect(linkText.marks).toHaveLength(1);
  });

  it('keeps internal link marks for available targets', () => {
    const d = doc(
      paragraph(text('read', [internalLink('res_available')])),
    );
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const para = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const nodes = para.content as Array<Record<string, unknown>>;
    expect((nodes[0] as Record<string, unknown>).marks).toHaveLength(1);
  });

  it('does not mutate the original document', () => {
    const d = doc(relatedResource('res_gone'));
    const original = JSON.parse(JSON.stringify(d));
    filterDocumentBody(d, ctx);
    expect(d).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// extractCtaFromBody
// ---------------------------------------------------------------------------

describe('extractCtaFromBody', () => {
  it('extracts the first CTA node from the body', () => {
    const d = doc(
      paragraph(text('hello')),
      cta('open_content', 'res_target', 'Read more'),
    );
    const extracted = extractCtaFromBody(d);
    expect(extracted).toEqual({
      kind: 'open_content',
      targetId: 'res_target',
      label: 'Read more',
    });
  });

  it('returns null targetId when CTA has no targetId', () => {
    const d = doc(cta('suggest_topic', null, null));
    const extracted = extractCtaFromBody(d);
    expect(extracted).toEqual({
      kind: 'suggest_topic',
      targetId: null,
      label: null,
    });
  });

  it('returns null when there is no CTA node', () => {
    const d = doc(paragraph(text('hello')));
    expect(extractCtaFromBody(d)).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(extractCtaFromBody(null)).toBeNull();
    expect(extractCtaFromBody(undefined)).toBeNull();
  });
});
