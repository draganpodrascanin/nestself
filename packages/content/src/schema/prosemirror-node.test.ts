// Guards C-03: ProseMirror structural validation runs in Node without a DOM.
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { extensions } from './extensions.ts';

const schema = getSchema(extensions);

describe('ProseMirror validation in Node (no DOM)', () => {
  it('runs without DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('accepts a sectionHeading and a paragraph', () => {
    const node = Node.fromJSON(schema, {
      type: 'doc',
      content: [
        { type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    });
    expect(() => node.check()).not.toThrow();
  });

  it('rejects an unknown node type', () => {
    expect(() =>
      Node.fromJSON(schema, { type: 'doc', content: [{ type: 'scriptBlock' }] }),
    ).toThrow();
  });

  it('rejects a doc that violates content rules (listItem directly under doc)', () => {
    // listItem is not in doc's content expression.
    // Node.fromJSON may create the node without throwing, but
    // node.check() enforces the content expression and throws.
    const node = Node.fromJSON(schema, {
      type: 'doc',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    });
    expect(() => node.check()).toThrow();
  });

  it('accepts a bulletList with nested listItems', () => {
    const node = Node.fromJSON(schema, {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }],
            },
          ],
        },
      ],
    });
    expect(() => node.check()).not.toThrow();
  });

  it('accepts all custom block types', () => {
    const node = Node.fromJSON(schema, {
      type: 'doc',
      content: [
        { type: 'sectionHeading', attrs: { level: 3 } },
        { type: 'paragraph' },
        { type: 'quote', content: [{ type: 'paragraph' }] },
        { type: 'image', attrs: { mediaAssetId: 'a', alt: 'x' } },
        { type: 'professionalNote', attrs: { noteKind: 'tip' }, content: [{ type: 'paragraph' }] },
        { type: 'practicalStep', attrs: { stepNumber: 1, title: 't' }, content: [{ type: 'paragraph' }] },
        { type: 'checklist', content: [{ type: 'checklistItem', attrs: { label: 'l' } }] },
        { type: 'approvedMedia', attrs: { mediaAssetId: 'b', kind: 'pdf' } },
        { type: 'transcript', attrs: { mediaAssetId: 'c' }, content: [{ type: 'paragraph' }] },
        { type: 'relatedResource', attrs: { contentResourceId: 'r' } },
        { type: 'cta', attrs: { ctaKind: 'suggest_topic' } },
      ],
    });
    expect(() => node.check()).not.toThrow();
  });

  it('rejects a paragraph directly inside bulletList (nesting violation)', () => {
    // bulletList content expression is "listItem+", not "paragraph"
    const node = Node.fromJSON(schema, {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'paragraph' }],
        },
      ],
    });
    expect(() => node.check()).toThrow();
  });
});
