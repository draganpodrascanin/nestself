/**
 * Round-trip converters between Tiptap editor JSON and ContentDocument.
 *
 * `toContentDocument(editor)` extracts the JSON from the editor,
 * wraps it in a ContentDocument envelope ({type:'doc', schemaVersion, content}).
 * It also strips extraneous attributes that Tiptap extensions produce
 * but the strict Zod schema rejects (e.g. orderedList's `type: null`).
 *
 * `fromContentDocument(doc)` takes a ContentDocument and returns the
 * JSON suitable for `editor.commands.setContent()`.
 */
import type { Editor } from '@tiptap/core';
import { CURRENT_SCHEMA_VERSION, type ContentDocument } from '../schema/document.ts';

// ---------------------------------------------------------------------------
// Attribute stripping
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/**
 * Walk the node tree and strip extraneous attributes that Tiptap
 * extensions produce but the strict Zod schema rejects.
 *
 * - orderedList: remove `type` attr (StarterKit emits `type: null`)
 * - link marks: keep only `href` (remove target, rel, class, title)
 * - All nodes: remove falsy `attrs` objects that are empty after cleanup
 */
function cleanNode(node: RawNode): RawNode {
  const cleaned = { ...node };

  // Strip orderedList's `type` attribute (Tiptap StarterKit artifact)
  if (cleaned.type === 'orderedList' && cleaned.attrs) {
    const { type: _type, ...rest } = cleaned.attrs;
    cleaned.attrs = Object.keys(rest).length > 0 ? rest : undefined;
  }

  // Strip extraneous link mark attributes (keep only href)
  if (cleaned.marks) {
    cleaned.marks = cleaned.marks.map((mark) => {
      if (mark.type === 'link' && mark.attrs) {
        return { type: 'link', attrs: { href: mark.attrs.href } };
      }
      return mark;
    });
  }

  // Recurse into children
  if (cleaned.content) {
    cleaned.content = cleaned.content.map(cleanNode);
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts a ContentDocument from the current editor state.
 *
 * The editor's internal JSON is `{type:'doc', content:[...]}`.
 * We add `schemaVersion` to match the ContentDocument shape and
 * strip extraneous attributes that would fail validation.
 */
export function toContentDocument(editor: Editor): ContentDocument {
  const json = editor.getJSON();
  const content = (json.content ?? []) as RawNode[];
  return {
    type: 'doc',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    content: content.map(cleanNode) as ContentDocument['content'],
  };
}

/**
 * Converts a ContentDocument to Tiptap-compatible JSON for
 * `editor.commands.setContent()`.
 *
 * Strips `schemaVersion` since Tiptap doesn't know about it.
 */
export function fromContentDocument(
  doc: ContentDocument,
): Record<string, unknown> {
  return {
    type: 'doc',
    content: doc.content,
  };
}
