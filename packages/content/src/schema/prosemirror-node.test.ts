// Guards C-03: ProseMirror structural validation runs in Node without a DOM.
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

const schema = getSchema([StarterKit]);

describe('ProseMirror validation in Node (no DOM)', () => {
  it('runs without DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('accepts a heading and a paragraph', () => {
    const node = Node.fromJSON(schema, {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
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

  it('rejects a doc that violates content rules', () => {
    const node = Node.fromJSON(schema, {
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'paragraph' }] }],
    });
    expect(() => node.check()).toThrow();
  });
});
