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

  it('returns the first CTA when multiple exist at top level', () => {
    const d = doc(
      cta('open_content', 'res_first', 'First'),
      cta('suggest_topic', null, 'Second'),
    );
    const extracted = extractCtaFromBody(d);
    expect(extracted).toEqual({
      kind: 'open_content',
      targetId: 'res_first',
      label: 'First',
    });
  });

  it('does NOT find CTA nested inside another node (top-level only)', () => {
    const d = doc({
      type: 'professionalNote',
      content: [cta('open_content', 'res_nested', 'Nested')],
    });
    expect(extractCtaFromBody(d)).toBeNull();
  });

  it('extracts each known CTA kind correctly', () => {
    for (const kind of [
      'open_content', 'open_collection', 'suggest_topic',
      'ask_general_question', 'express_event_interest', 'open_service',
    ]) {
      const d = doc(cta(kind, 'target_1', `Label for ${kind}`));
      const extracted = extractCtaFromBody(d);
      expect(extracted).toEqual({
        kind,
        targetId: 'target_1',
        label: `Label for ${kind}`,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Nested structure tests — collectReferencedResourceIds
// ---------------------------------------------------------------------------

describe('collectReferencedResourceIds (nested structures)', () => {
  it('collects internal link inside bulletList > listItem > paragraph', () => {
    const d = doc({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [paragraph(text('see ', []), text('here', [internalLink('res_nested_link')]))],
      }],
    });
    expect(collectReferencedResourceIds(d)).toEqual(['res_nested_link']);
  });

  it('collects relatedResource inside blockquote', () => {
    const d = doc({
      type: 'blockquote',
      content: [relatedResource('res_in_quote')],
    });
    expect(collectReferencedResourceIds(d)).toEqual(['res_in_quote']);
  });

  it('collects CTA targetId inside professionalNote', () => {
    const d = doc({
      type: 'professionalNote',
      content: [cta('open_content', 'res_in_note')],
    });
    expect(collectReferencedResourceIds(d)).toEqual(['res_in_note']);
  });

  it('collects mixed references at various depths', () => {
    const d = doc(
      relatedResource('res_top'),
      {
        type: 'blockquote',
        content: [
          paragraph(text('link', [internalLink('res_in_bq')])),
          {
            type: 'bulletList',
            content: [{
              type: 'listItem',
              content: [
                relatedResource('res_in_li'),
                paragraph(text('deep', [internalLink('res_deep')])),
              ],
            }],
          },
        ],
      },
      cta('open_collection', 'res_cta'),
    );
    const ids = collectReferencedResourceIds(d).sort();
    expect(ids).toEqual(['res_cta', 'res_deep', 'res_in_bq', 'res_in_li', 'res_top']);
  });

  it('collects deeply nested: blockquote > bulletList > listItem > paragraph > text with link', () => {
    const d = doc({
      type: 'blockquote',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [paragraph(text('deep link', [internalLink('res_very_deep')]))],
        }],
      }],
    });
    expect(collectReferencedResourceIds(d)).toEqual(['res_very_deep']);
  });
});

// ---------------------------------------------------------------------------
// Nested structure tests — filterDocumentBody
// ---------------------------------------------------------------------------

describe('filterDocumentBody (nested structures)', () => {
  const ctx: FilterContext = {
    availableIds: new Set(['res_available']),
    capabilities: ['library'],
  };

  it('drops relatedResource inside bulletList listItem when unavailable', () => {
    const d = doc({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [
          relatedResource('res_available'),
          relatedResource('res_gone'),
          paragraph(text('text')),
        ],
      }],
    });
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const bulletList = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const listItem = (bulletList.content as unknown[])[0] as Record<string, unknown>;
    const liContent = listItem.content as unknown[];
    // relatedResource('res_gone') should be dropped; available one + paragraph remain
    expect(liContent).toHaveLength(2);
    expect((liContent[0] as Record<string, unknown>).type).toBe('relatedResource');
    expect((liContent[1] as Record<string, unknown>).type).toBe('paragraph');
  });

  it('unwraps internal link inside blockquote paragraph when target unavailable', () => {
    const d = doc({
      type: 'blockquote',
      content: [
        paragraph(
          text('click '),
          text('this', [internalLink('res_gone')]),
        ),
      ],
    });
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const bq = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const para = (bq.content as unknown[])[0] as Record<string, unknown>;
    const nodes = para.content as Array<Record<string, unknown>>;
    const linkNode = nodes.find((n) => n.text === 'this')!;
    expect(linkNode).toBeTruthy();
    expect(linkNode.marks).toBeUndefined();
  });

  it('filters CTA inside professionalNote by capability', () => {
    const noCalls: FilterContext = {
      availableIds: new Set(),
      capabilities: ['library'], // no 'calls'
    };
    const d = doc({
      type: 'professionalNote',
      content: [cta('open_service', 'calls')],
    });
    const filtered = filterDocumentBody(d, noCalls) as Record<string, unknown>;
    const note = (filtered.content as unknown[])[0] as Record<string, unknown>;
    expect((note.content as unknown[]).length).toBe(0);
  });

  it('keeps CTA inside professionalNote when capability is present', () => {
    const withCalls: FilterContext = {
      availableIds: new Set(),
      capabilities: ['library', 'calls'],
    };
    const d = doc({
      type: 'professionalNote',
      content: [cta('open_service', 'calls')],
    });
    const filtered = filterDocumentBody(d, withCalls) as Record<string, unknown>;
    const note = (filtered.content as unknown[])[0] as Record<string, unknown>;
    expect((note.content as unknown[]).length).toBe(1);
  });

  it('handles multiple links in one paragraph: one available, one not', () => {
    const d = doc(
      paragraph(
        text('available ', [internalLink('res_available')]),
        text(' and '),
        text('gone', [internalLink('res_gone')]),
      ),
    );
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const para = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const nodes = para.content as Array<Record<string, unknown>>;

    const availNode = nodes.find((n) => n.text === 'available ')!;
    expect(availNode.marks).toHaveLength(1); // link kept

    const goneNode = nodes.find((n) => n.text === 'gone')!;
    expect(goneNode.marks).toBeUndefined(); // link unwrapped
  });

  it('drops unavailable relatedResource inside orderedList, keeps available', () => {
    const d = doc({
      type: 'orderedList',
      content: [{
        type: 'listItem',
        content: [
          relatedResource('res_available'),
          relatedResource('res_gone'),
        ],
      }],
    });
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const ol = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const li = (ol.content as unknown[])[0] as Record<string, unknown>;
    expect((li.content as unknown[]).length).toBe(1);
    const kept = (li.content as unknown[])[0] as Record<string, unknown>;
    expect((kept.attrs as Record<string, unknown>).contentResourceId).toBe('res_available');
  });

  it('deeply nested: blockquote > bulletList > listItem > paragraph > link unwrap', () => {
    const d = doc({
      type: 'blockquote',
      content: [{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [
            paragraph(text('deep link', [internalLink('res_gone')])),
          ],
        }],
      }],
    });
    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const bq = (filtered.content as unknown[])[0] as Record<string, unknown>;
    const bl = (bq.content as unknown[])[0] as Record<string, unknown>;
    const li = (bl.content as unknown[])[0] as Record<string, unknown>;
    const para = (li.content as unknown[])[0] as Record<string, unknown>;
    const textNode = (para.content as Array<Record<string, unknown>>)[0]!;
    expect(textNode.text).toBe('deep link');
    expect(textNode.marks).toBeUndefined();
  });

  it('does not mutate the original nested document', () => {
    const d = doc({
      type: 'blockquote',
      content: [
        relatedResource('res_gone'),
        paragraph(text('link', [internalLink('res_gone')])),
      ],
    });
    const original = JSON.parse(JSON.stringify(d));
    filterDocumentBody(d, ctx);
    expect(d).toEqual(original);
  });

  it('complex document: mixed available and unavailable at multiple depths', () => {
    const d = doc(
      paragraph(text('intro')),
      relatedResource('res_available'),
      relatedResource('res_gone'),
      {
        type: 'blockquote',
        content: [
          paragraph(
            text('a link to '),
            text('available', [internalLink('res_available')]),
            text(' and '),
            text('gone', [internalLink('res_gone')]),
          ),
          relatedResource('res_gone'),
        ],
      },
      cta('open_content', 'res_available', 'Read'),
      cta('open_content', 'res_gone', 'Dropped'),
      cta('unknown_kind', null),
    );

    const filtered = filterDocumentBody(d, ctx) as Record<string, unknown>;
    const content = filtered.content as Array<Record<string, unknown>>;

    // paragraph kept
    expect(content[0]!.type).toBe('paragraph');
    // relatedResource('res_available') kept
    expect(content[1]!.type).toBe('relatedResource');
    // relatedResource('res_gone') dropped
    // blockquote kept (but relatedResource inside dropped, link unwrapped)
    expect(content[2]!.type).toBe('blockquote');
    const bqContent = content[2]!.content as Array<Record<string, unknown>>;
    // blockquote should contain just the paragraph (relatedResource dropped)
    expect(bqContent).toHaveLength(1);
    expect(bqContent[0]!.type).toBe('paragraph');
    // Within the paragraph, 'available' link should be kept, 'gone' unwrapped
    const paraNodes = bqContent[0]!.content as Array<Record<string, unknown>>;
    const availLink = paraNodes.find((n) => n.text === 'available')!;
    expect(availLink.marks).toHaveLength(1);
    const goneLink = paraNodes.find((n) => n.text === 'gone')!;
    expect(goneLink.marks).toBeUndefined();

    // cta('open_content', 'res_available') kept
    expect(content[3]!.type).toBe('cta');
    // cta('open_content', 'res_gone') dropped
    // cta('unknown_kind') dropped
    expect(content).toHaveLength(4); // paragraph + relatedResource + blockquote + cta
  });
});
