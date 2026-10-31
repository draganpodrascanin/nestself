/**
 * The "+" handle applies a picker choice to the hovered block: text types
 * re-type a text block in place, insertables replace an empty paragraph or
 * land below a filled one.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Editor } from '@tiptap/core';
import { testExtensions } from './editor-test-extensions.ts';
import { createSlashMenuItems, type SlashMenuItem, type SlashMenuItemLabels } from './SlashMenu.tsx';
import { applyBlockPick, appliesInPlace } from './block-pick.ts';

const LABELS: SlashMenuItemLabels = {
  paragraph: 'Paragraph', paragraphHint: '', heading2: 'Heading 2', heading2Hint: '',
  heading3: 'Heading 3', heading3Hint: '', bulletList: 'Bullet list', bulletListHint: '',
  numberedList: 'Numbered list', numberedListHint: '', checklist: 'Checklist', checklistHint: '',
  quote: 'Quote', quoteHint: '', note: 'Note', noteHint: '', step: 'Step', stepHint: '',
  cta: 'Call to action', ctaHint: '', related: 'Related', relatedHint: '', image: 'Image', imageHint: '',
};
const items = createSlashMenuItems(LABELS);
const item = (id: string): SlashMenuItem => {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

const editor = new Editor({ extensions: testExtensions() });
afterAll(() => editor.destroy());

/** Top-level block types in document order, without the trailing empty paragraph TrailingNode keeps. */
const types = () => {
  const names = editor.state.doc.content.content.map((n) => n.type.name);
  const last = editor.state.doc.lastChild;
  if (names.length > 1 && last && last.type.name === 'paragraph' && last.content.size === 0) names.pop();
  return names;
};
/** Position of the top-level block at `index`. */
const posOf = (index: number) => {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize;
  return pos;
};
const load = (content: object[]) => editor.commands.setContent({ type: 'doc', content });

describe('applyBlockPick: text types', () => {
  it('turns a filled paragraph into a heading and keeps its text', () => {
    load([{ type: 'paragraph', content: [{ type: 'text', text: 'Small steps count.' }] }]);
    expect(applyBlockPick(editor, 0, item('slash-heading2'))).toBe(true);
    expect(types()).toEqual(['sectionHeading']);
    expect(editor.state.doc.child(0).attrs.level).toBe(2);
    expect(editor.state.doc.child(0).textContent).toBe('Small steps count.');
  });

  it('turns a heading back into a paragraph', () => {
    load([{ type: 'sectionHeading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Tips' }] }]);
    applyBlockPick(editor, 0, item('slash-paragraph'));
    expect(types()).toEqual(['paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('Tips');
  });

  it('wraps a paragraph into a bullet list and a quote', () => {
    load([{ type: 'paragraph', content: [{ type: 'text', text: 'Walk after lunch' }] }]);
    applyBlockPick(editor, 0, item('slash-bullet'));
    expect(types()).toEqual(['bulletList']);
    expect(editor.state.doc.child(0).textContent).toBe('Walk after lunch');

    load([{ type: 'paragraph', content: [{ type: 'text', text: 'Be kind' }] }]);
    applyBlockPick(editor, 0, item('slash-quote'));
    expect(types()).toEqual(['quote']);
  });

  it('re-types the second block, not the first', () => {
    load([
      { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
    ]);
    applyBlockPick(editor, posOf(1), item('slash-heading3'));
    expect(types()).toEqual(['paragraph', 'sectionHeading']);
    expect(editor.state.doc.child(1).textContent).toBe('Two');
  });

  it('starts a new heading below an image instead of re-typing it', () => {
    load([
      { type: 'image', attrs: { mediaAssetId: 'asset_1', alt: 'x', caption: null } },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ]);
    applyBlockPick(editor, 0, item('slash-heading2'));
    expect(types()).toEqual(['image', 'sectionHeading', 'paragraph']);
    expect(editor.state.doc.child(1).textContent).toBe('');
  });
});

describe('applyBlockPick: insertables', () => {
  it('replaces an empty paragraph with a note', () => {
    load([
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ]);
    applyBlockPick(editor, 0, item('slash-note'));
    expect(types()).toEqual(['professionalNote', 'paragraph']);
  });

  it('inserts a step below a filled paragraph and keeps the paragraph', () => {
    load([
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ]);
    applyBlockPick(editor, 0, item('slash-step'));
    expect(types()).toEqual(['paragraph', 'practicalStep', 'paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('Before');
  });

  it('inserts an image below a heading', () => {
    load([{ type: 'sectionHeading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] }]);
    applyBlockPick(editor, 0, item('slash-image'));
    expect(types().slice(0, 2)).toEqual(['sectionHeading', 'image']);
  });

  it('returns false when the block is gone', () => {
    load([{ type: 'paragraph' }]);
    expect(applyBlockPick(editor, 999, item('slash-note'))).toBe(false);
  });
});

describe('appliesInPlace', () => {
  it('flags insertables on the slash items', () => {
    const insertables = items.filter((i) => i.insert).map((i) => i.id).sort();
    expect(insertables).toEqual(['slash-cta', 'slash-image', 'slash-note', 'slash-related', 'slash-step']);
  });

  it('is true for text types on text blocks only', () => {
    load([
      { type: 'paragraph', content: [{ type: 'text', text: 'p' }] },
      { type: 'image', attrs: { mediaAssetId: 'a', alt: '', caption: null } },
    ]);
    expect(appliesInPlace(editor.state.doc.child(0), item('slash-heading2'))).toBe(true);
    expect(appliesInPlace(editor.state.doc.child(1), item('slash-heading2'))).toBe(false);
    expect(appliesInPlace(editor.state.doc.child(0), item('slash-note'))).toBe(false);
  });
});
