/**
 * Applying a block-picker choice to a hovered block (the "+" handle).
 *
 * The picker shows the same items as the slash menu. A pick either re-types
 * the hovered block in place or lands in a fresh paragraph after it:
 *
 * - a text type (paragraph, heading, list, quote) re-types a block that holds
 *   text; after an atom (image, call to action, related resource) it starts a
 *   new block below;
 * - an insertable (image, note, step, call to action, related resource)
 *   replaces an empty paragraph and otherwise goes below the hovered block.
 *
 * Each item's own `command` runs with a collapsed range, exactly as the slash
 * menu runs it once the typed "/" is gone, so both entry points behave alike.
 */
import type { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { SlashMenuItem } from './SlashMenu.tsx';

/** Blocks whose text a text-type pick re-types in place. */
const RETYPABLE = new Set([
  'paragraph',
  'sectionHeading',
  'bulletList',
  'orderedList',
  'checklist',
  'quote',
  'professionalNote',
  'practicalStep',
]);

export function isEmptyParagraph(node: PmNode): boolean {
  return node.type.name === 'paragraph' && node.content.size === 0;
}

/** Whether `item` applies to `node` itself rather than to a new block below. */
export function appliesInPlace(node: PmNode, item: SlashMenuItem): boolean {
  return item.insert ? isEmptyParagraph(node) : RETYPABLE.has(node.type.name);
}

/**
 * Run `item` for the top-level block at `pos`. Returns false when there is
 * no block at `pos` (the handle lost its target), true otherwise.
 */
export function applyBlockPick(editor: Editor, pos: number, item: SlashMenuItem): boolean {
  if (pos < 0 || pos >= editor.state.doc.content.size) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;

  let from: number;
  if (appliesInPlace(node, item)) {
    from = TextSelection.near(editor.state.doc.resolve(pos + 1)).from;
    editor.chain().focus().setTextSelection(from).run();
  } else {
    const end = pos + node.nodeSize;
    editor.chain().focus().insertContentAt(end, { type: 'paragraph' }).run();
    from = end + 1;
    editor.commands.setTextSelection(from);
  }
  item.command({ editor, range: { from, to: from } });
  return true;
}
