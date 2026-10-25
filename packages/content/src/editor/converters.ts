/**
 * Round-trip converters between Tiptap editor JSON and ContentDocument.
 *
 * `toContentDocument(editor)` extracts the JSON from the editor,
 * wraps it in a ContentDocument envelope ({type:'doc', schemaVersion, content}).
 *
 * `fromContentDocument(doc)` takes a ContentDocument and returns the
 * JSON suitable for `editor.commands.setContent()`.
 */
import type { Editor } from '@tiptap/core';
import { CURRENT_SCHEMA_VERSION, type ContentDocument } from '../schema/document.ts';

/**
 * Extracts a ContentDocument from the current editor state.
 *
 * The editor's internal JSON is `{type:'doc', content:[...]}`.
 * We add `schemaVersion` to match the ContentDocument shape.
 */
export function toContentDocument(editor: Editor): ContentDocument {
  const json = editor.getJSON();
  return {
    type: 'doc',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    content: (json.content ?? []) as ContentDocument['content'],
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
