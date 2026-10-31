/**
 * Moving a top-level block to a drop position (the grip drag's mouseup).
 * The drop line itself needs layout and is covered by the e2e editor gate.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Editor } from '@tiptap/core';
import { testExtensions } from './editor-test-extensions.ts';
import { moveBlock } from './BlockHandle.tsx';

const editor = new Editor({ extensions: testExtensions() });
afterAll(() => editor.destroy());

const text = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const load = () =>
  editor.commands.setContent({ type: 'doc', content: [text('A'), text('B'), text('C')] });
const order = () => editor.state.doc.content.content.map((n) => n.textContent).join('');
/** Start position of the top-level block at `index`. */
const posOf = (index: number) => {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize;
  return pos;
};
const endOf = (index: number) => posOf(index) + editor.state.doc.child(index).nodeSize;

describe('moveBlock', () => {
  it('moves a block down to after a later block', () => {
    load();
    expect(moveBlock(editor, posOf(0), endOf(2))).toBe(true);
    expect(order()).toBe('BCA');
  });

  it('moves a block up to before an earlier block', () => {
    load();
    expect(moveBlock(editor, posOf(2), posOf(0))).toBe(true);
    expect(order()).toBe('CAB');
  });

  it('moves a block one place down (drop below the next block)', () => {
    load();
    expect(moveBlock(editor, posOf(0), endOf(1))).toBe(true);
    expect(order()).toBe('BAC');
  });

  it('is a no-op when dropped at its own edges', () => {
    load();
    expect(moveBlock(editor, posOf(1), posOf(1))).toBe(false);
    expect(moveBlock(editor, posOf(1), endOf(1))).toBe(false);
    expect(order()).toBe('ABC');
  });

  it('puts the cursor in the moved block', () => {
    load();
    moveBlock(editor, posOf(0), endOf(2));
    expect(editor.state.selection.$from.parent.textContent).toBe('A');
  });
});
