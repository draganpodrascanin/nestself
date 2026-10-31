/**
 * Tests for ContentDocumentSchema: valid documents for every block type,
 * boundary limits, strict objects, link href validation, CTA discriminated
 * union, ProseMirror round-trip, ContentIdSchema.
 */
import { getSchema } from '@tiptap/core';
import { Node as PmNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { ContentDocumentSchema, MAX_NODES } from './document.ts';
import { extensions } from './extensions.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function doc(content: unknown[]) {
  return { type: 'doc', schemaVersion: 1, content };
}

function paragraph(text = 'Hello') {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Valid documents for every block type
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — valid blocks', () => {
  it('accepts a minimal document with one paragraph', () => {
    expect(ContentDocumentSchema.safeParse(doc([paragraph()])).success).toBe(true);
  });

  it('accepts sectionHeading level 2', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }]),
    ).success).toBe(true);
  });

  it('accepts sectionHeading level 3', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'sectionHeading', attrs: { level: 3 } }]),
    ).success).toBe(true);
  });

  it('accepts text with bold, italic and link marks', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      }]),
    ).success).toBe(true);
  });

  it('accepts bulletList with listItems', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph()] }] }]),
    ).success).toBe(true);
  });

  it('accepts orderedList with null start (C1)', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'orderedList', attrs: { start: null }, content: [{ type: 'listItem', content: [paragraph()] }] }]),
    ).success).toBe(true);
  });

  it('accepts exactly two levels of nested lists (I3)', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [
            paragraph(),
            { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph()] }] },
          ],
        }],
      }]),
    ).success).toBe(true);
  });

  it('accepts quote with null attribution (C1)', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'quote', attrs: { attribution: null }, content: [paragraph('A wise saying')] }]),
    ).success).toBe(true);
  });

  it('accepts image with null caption (C1)', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'image', attrs: { mediaAssetId: 'asset-1', alt: 'Description', caption: null } }]),
    ).success).toBe(true);
  });

  it('accepts professionalNote', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'professionalNote', attrs: { noteKind: 'warning' }, content: [paragraph('Be careful')] }]),
    ).success).toBe(true);
  });

  it('accepts practicalStep', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'practicalStep', attrs: { stepNumber: 1, title: 'First step' }, content: [paragraph('Do this')] }]),
    ).success).toBe(true);
  });

  it('accepts checklist', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'checklist', content: [{ type: 'checklistItem', attrs: { label: 'Task 1' } }] }]),
    ).success).toBe(true);
  });

  it('accepts approvedMedia + transcript', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([
        { type: 'approvedMedia', attrs: { mediaAssetId: 'media-1', kind: 'audio' } },
        { type: 'transcript', attrs: { mediaAssetId: 'media-1' }, content: [paragraph('text')] },
      ]),
    ).success).toBe(true);
  });

  it('accepts approvedMedia (pdf) without transcript', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'approvedMedia', attrs: { mediaAssetId: 'pdf-1', kind: 'pdf' } }]),
    ).success).toBe(true);
  });

  it('accepts relatedResource', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'relatedResource', attrs: { contentResourceId: 'res-1' } }]),
    ).success).toBe(true);
  });

  it('accepts all CTA kinds (I6)', () => {
    for (const ctaKind of ['suggest_topic', 'ask_general_question', 'express_event_interest'] as const) {
      expect(ContentDocumentSchema.safeParse(doc([{ type: 'cta', attrs: { ctaKind } }])).success, ctaKind).toBe(true);
    }
    for (const ctaKind of ['open_content', 'open_collection'] as const) {
      expect(ContentDocumentSchema.safeParse(doc([{ type: 'cta', attrs: { ctaKind, targetId: 'res-1' } }])).success, ctaKind).toBe(true);
    }
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'cta', attrs: { ctaKind: 'open_service', targetId: 'library' } }])).success).toBe(true);
  });

  it('accepts hardBreak inside a paragraph (R1)', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }]),
    ).success).toBe(true);
  });

  it('accepts hardBreak inside a checklistItem (R1)', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{
        type: 'checklist',
        content: [{ type: 'checklistItem', attrs: { label: 'l' }, content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }] }],
      }]),
    ).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C1: ProseMirror toJSON() round-trip
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — ProseMirror round-trip (C1)', () => {
  it('validates toJSON() output of all block types', () => {
    const schema = getSchema(extensions);
    const allBlocks = {
      type: 'doc',
      content: [
        { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'quote', attrs: { attribution: null }, content: [{ type: 'paragraph' }] },
        { type: 'image', attrs: { mediaAssetId: 'img-1', alt: 'x', caption: null } },
        { type: 'professionalNote', attrs: { noteKind: 'tip' }, content: [{ type: 'paragraph' }] },
        { type: 'practicalStep', attrs: { stepNumber: 1, title: 'Step' }, content: [{ type: 'paragraph' }] },
        { type: 'checklist', content: [{ type: 'checklistItem', attrs: { label: 'ok' } }] },
        { type: 'approvedMedia', attrs: { mediaAssetId: 'aud-1', kind: 'audio', caption: null } },
        { type: 'transcript', attrs: { mediaAssetId: 'aud-1' }, content: [{ type: 'paragraph' }] },
        { type: 'relatedResource', attrs: { contentResourceId: 'r1' } },
        { type: 'cta', attrs: { ctaKind: 'suggest_topic', targetId: null, label: null } },
      ],
    };
    const pmNode = PmNode.fromJSON(schema, allBlocks);
    const roundTripped = pmNode.toJSON();
    (roundTripped as Record<string, unknown>).schemaVersion = 1;
    expect(ContentDocumentSchema.safeParse(roundTripped).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — rejection', () => {
  it('rejects unknown node type', () => {
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'scriptBlock', content: [] }])).success).toBe(false);
  });

  it('rejects unknown mark', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'underline' }] }] }]),
    ).success).toBe(false);
  });

  it('rejects heading level 1', () => {
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'sectionHeading', attrs: { level: 1 } }])).success).toBe(false);
  });

  it('rejects heading level 4', () => {
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'sectionHeading', attrs: { level: 4 } }])).success).toBe(false);
  });

  it('rejects empty document', () => {
    expect(ContentDocumentSchema.safeParse({ type: 'doc', schemaVersion: 1, content: [] }).success).toBe(false);
  });

  it('rejects text > 5000 characters', () => {
    expect(ContentDocumentSchema.safeParse(doc([paragraph('x'.repeat(5001))])).success).toBe(false);
  });

  it('accepts text at exactly 5000 characters', () => {
    expect(ContentDocumentSchema.safeParse(doc([paragraph('x'.repeat(5000))])).success).toBe(true);
  });

  it('rejects checklist with > 20 items', () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ type: 'checklistItem', attrs: { label: `Item ${i}` } }));
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'checklist', content: items }])).success).toBe(false);
  });

  it('rejects bulletList with > 20 items', () => {
    const items = Array.from({ length: 21 }, () => ({ type: 'listItem', content: [paragraph()] }));
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'bulletList', content: items }])).success).toBe(false);
  });

  it(`rejects > ${MAX_NODES} content nodes`, () => {
    expect(ContentDocumentSchema.safeParse(doc(Array.from({ length: MAX_NODES + 1 }, () => paragraph()))).success).toBe(false);
  });

  it(`accepts exactly ${MAX_NODES} content nodes`, () => {
    expect(ContentDocumentSchema.safeParse(doc(Array.from({ length: MAX_NODES }, () => paragraph()))).success).toBe(true);
  });

  it('rejects missing schemaVersion', () => {
    expect(ContentDocumentSchema.safeParse({ type: 'doc', content: [{ type: 'paragraph' }] }).success).toBe(false);
  });

  it('rejects hardBreak at the document level (R1)', () => {
    expect(ContentDocumentSchema.safeParse(doc([paragraph(), { type: 'hardBreak' }])).success).toBe(false);
  });

  it('rejects extra top-level keys (C2)', () => {
    expect(ContentDocumentSchema.safeParse({ type: 'doc', schemaVersion: 1, content: [paragraph()], extra: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C2: strictObject rejects unknown keys
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — unknown key rejection (C2)', () => {
  it('rejects hardBreak with marks', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'paragraph', content: [{ type: 'hardBreak', marks: [{ type: 'bold' }] }] }]),
    ).success).toBe(false);
  });

  it('rejects link mark with onclick', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'click',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' }, onclick: 'alert(1)' }],
        }],
      }]),
    ).success).toBe(false);
  });

  it('rejects link attrs with target', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'click',
          marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }],
        }],
      }]),
    ).success).toBe(false);
  });

  it('rejects image with src/onerror (injection)', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'image', attrs: { mediaAssetId: 'img-1', alt: 'ok', src: 'evil.png', onerror: 'alert(1)' } }]),
    ).success).toBe(false);
  });

  it('rejects bold with attrs', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{
        type: 'paragraph',
        content: [{ type: 'text', text: 'hi', marks: [{ type: 'bold', attrs: { weight: 700 } }] }],
      }]),
    ).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I3/I4: Link href validation at the Zod layer (R4)
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — link href validation (R4)', () => {
  function linkDoc(href: string) {
    return doc([{
      type: 'paragraph',
      content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }],
    }]);
  }

  it('rejects empty href', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('')).success).toBe(false);
  });

  it('rejects href with leading whitespace', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc(' https://allowed.example/')).success).toBe(false);
  });

  it('rejects href with embedded newline', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('nestself:content/abc \n')).success).toBe(false);
  });

  it('rejects href with userinfo', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('https://evil.example@allowed.example')).success).toBe(false);
  });

  it('rejects href with non-default port', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('https://allowed.example:8443/')).success).toBe(false);
  });

  it('rejects javascript: href', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('javascript:alert(1)')).success).toBe(false);
  });

  it('rejects data: href', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('data:text/html,<script>alert(1)</script>')).success).toBe(false);
  });

  it('rejects http: href', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('http://example.com')).success).toBe(false);
  });

  it('accepts https: href', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('https://example.com')).success).toBe(true);
  });

  it('accepts nestself:content/ href', () => {
    expect(ContentDocumentSchema.safeParse(linkDoc('nestself:content/abc-123')).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// I5: ContentIdSchema
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — ContentIdSchema (I5)', () => {
  it('rejects URL-looking mediaAssetId', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'image', attrs: { mediaAssetId: 'https://evil.com/img.png', alt: 'x' } }]),
    ).success).toBe(false);
  });

  it('rejects mediaAssetId > 64 chars', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'image', attrs: { mediaAssetId: 'a'.repeat(65), alt: 'x' } }]),
    ).success).toBe(false);
  });

  it('rejects empty mediaAssetId', () => {
    expect(ContentDocumentSchema.safeParse(
      doc([{ type: 'image', attrs: { mediaAssetId: '', alt: 'x' } }]),
    ).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I6: CTA discriminated union
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — CTA discriminated union (I6)', () => {
  it('rejects open_content without targetId', () => {
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'cta', attrs: { ctaKind: 'open_content' } }])).success).toBe(false);
  });

  it('rejects suggest_topic with targetId', () => {
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'cta', attrs: { ctaKind: 'suggest_topic', targetId: 'res-1' } }])).success).toBe(false);
  });

  it('rejects open_service with invalid capability', () => {
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'cta', attrs: { ctaKind: 'open_service', targetId: 'invalid-cap' } }])).success).toBe(false);
  });

  it('accepts open_service with valid capability', () => {
    expect(ContentDocumentSchema.safeParse(doc([{ type: 'cta', attrs: { ctaKind: 'open_service', targetId: 'library' } }])).success).toBe(true);
  });
});
