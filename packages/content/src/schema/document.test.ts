/**
 * Tests for ContentDocumentSchema: valid documents for every block type,
 * boundary limits, unknown nodes/marks, heading levels, CTA and
 * relatedResource counts.
 */
import { describe, expect, it } from 'vitest';

import {
  ContentDocumentSchema,
  MAX_NODES,
} from './document.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap content in a minimal valid document shell. */
function doc(content: unknown[]) {
  return {
    type: 'doc',
    schemaVersion: 1,
    content,
  };
}

function paragraph(text = 'Hello') {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

// ---------------------------------------------------------------------------
// Valid documents for every block type
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — valid blocks', () => {
  it('accepts a minimal document with one paragraph', () => {
    const result = ContentDocumentSchema.safeParse(doc([paragraph()]));
    expect(result.success).toBe(true);
  });

  it('accepts sectionHeading level 2', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts sectionHeading level 3', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'sectionHeading', attrs: { level: 3 } }]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts text with bold, italic and link marks', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts bulletList with listItems', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph()] }],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts orderedList with start attribute', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'orderedList',
          attrs: { start: 5 },
          content: [{ type: 'listItem', content: [paragraph()] }],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts nested lists', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                paragraph(),
                {
                  type: 'orderedList',
                  content: [{ type: 'listItem', content: [paragraph()] }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts quote with attribution', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'quote',
          attrs: { attribution: 'Someone' },
          content: [paragraph('A wise saying')],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts image with required attrs', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'image',
          attrs: { mediaAssetId: 'asset-1', alt: 'Description', caption: 'Fig 1' },
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts professionalNote', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'professionalNote',
          attrs: { noteKind: 'warning' },
          content: [paragraph('Be careful')],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts practicalStep', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'practicalStep',
          attrs: { stepNumber: 1, title: 'First step' },
          content: [paragraph('Do this')],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts checklist with checklistItems', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'checklist',
          content: [
            { type: 'checklistItem', attrs: { label: 'Task 1' } },
            { type: 'checklistItem', attrs: { label: 'Task 2' } },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts approvedMedia (audio) followed by transcript', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'approvedMedia',
          attrs: { mediaAssetId: 'media-1', kind: 'audio' },
        },
        {
          type: 'transcript',
          attrs: { mediaAssetId: 'media-1' },
          content: [paragraph('Transcript text')],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts approvedMedia (pdf) without transcript', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'approvedMedia',
          attrs: { mediaAssetId: 'media-pdf', kind: 'pdf' },
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts relatedResource', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        { type: 'relatedResource', attrs: { contentResourceId: 'res-1' } },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('accepts cta with all CTA kinds', () => {
    for (const ctaKind of [
      'open_content',
      'open_collection',
      'suggest_topic',
      'ask_general_question',
      'express_event_interest',
      'open_service',
    ]) {
      const result = ContentDocumentSchema.safeParse(
        doc([
          { type: 'cta', attrs: { ctaKind, targetId: 'target-1', label: 'Click' } },
        ]),
      );
      expect(result.success, `CTA kind '${ctaKind}' should be valid`).toBe(true);
    }
  });

  it('accepts hardBreak inside a paragraph', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Line 1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Line 2' },
          ],
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects hardBreak at the document level (inline node, not block)', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([paragraph(), { type: 'hardBreak' }]),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe('ContentDocumentSchema — rejection', () => {
  it('rejects unknown node type', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'scriptBlock', content: [] }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects unknown mark', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'hi', marks: [{ type: 'underline' }] },
          ],
        },
      ]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects heading level 1', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'sectionHeading', attrs: { level: 1 } }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects heading level 4', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'sectionHeading', attrs: { level: 4 } }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty document (no content)', () => {
    const result = ContentDocumentSchema.safeParse({
      type: 'doc',
      schemaVersion: 1,
      content: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects text node exceeding 5,000 characters', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([paragraph('x'.repeat(5001))]),
    );
    expect(result.success).toBe(false);
  });

  it('accepts text node at exactly 5,000 characters', () => {
    const result = ContentDocumentSchema.safeParse(
      doc([paragraph('x'.repeat(5000))]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects checklist with more than 20 items', () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      type: 'checklistItem',
      attrs: { label: `Item ${i}` },
    }));
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'checklist', content: items }]),
    );
    expect(result.success).toBe(false);
  });

  it('accepts checklist at exactly 20 items', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      type: 'checklistItem',
      attrs: { label: `Item ${i}` },
    }));
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'checklist', content: items }]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects bulletList with more than 20 items', () => {
    const items = Array.from({ length: 21 }, () => ({
      type: 'listItem',
      content: [paragraph()],
    }));
    const result = ContentDocumentSchema.safeParse(
      doc([{ type: 'bulletList', content: items }]),
    );
    expect(result.success).toBe(false);
  });

  it(`rejects more than ${MAX_NODES} content nodes`, () => {
    const nodes = Array.from({ length: MAX_NODES + 1 }, () => paragraph());
    const result = ContentDocumentSchema.safeParse(doc(nodes));
    expect(result.success).toBe(false);
  });

  it(`accepts exactly ${MAX_NODES} content nodes`, () => {
    const nodes = Array.from({ length: MAX_NODES }, () => paragraph());
    const result = ContentDocumentSchema.safeParse(doc(nodes));
    expect(result.success).toBe(true);
  });

  it('rejects missing schemaVersion', () => {
    const result = ContentDocumentSchema.safeParse({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
    expect(result.success).toBe(false);
  });
});
