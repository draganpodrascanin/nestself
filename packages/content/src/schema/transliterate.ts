/**
 * Content document transliteration (FMT-R-26, C-28).
 *
 * Walks the document tree and transliterates all text-bearing
 * attributes to Serbian Cyrillic, preserving ids, hrefs, marks,
 * enums, numbers.
 *
 * The core transliteration function lives in `@nestself/i18n/transliterate`
 * (I11) — the single shared implementation.
 *
 * Mark arrays are cloned so the output does not share references
 * with the input (17).
 */
import { transliterate } from '@nestself/i18n/transliterate';

import type { ContentDocument } from './document.ts';

/**
 * Transliterate a single string from Serbian Latin to Cyrillic.
 * Re-exports the canonical implementation from `@nestself/i18n`.
 */
export function transliterateText(text: string): string {
  return transliterate(text);
}

// ---------------------------------------------------------------------------
// Typed node walker
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/**
 * Deep-clone and transliterate a single node.
 */
function transliterateNode(node: RawNode): RawNode {
  const result: RawNode = { type: node.type };

  // Transliterate text
  if (node.text !== undefined) {
    result.text = transliterate(node.text);
  }

  // Deep-clone marks (17: do not share mark arrays with input)
  if (node.marks) {
    result.marks = node.marks.map((mark) => {
      const cloned: { type: string; attrs?: Record<string, unknown> } = { type: mark.type };
      if (mark.attrs) {
        cloned.attrs = { ...mark.attrs };
      }
      return cloned;
    });
  }

  // Handle attributes — transliterate text-bearing ones, preserve ids/enums/numbers
  if (node.attrs) {
    const attrs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.attrs)) {
      switch (key) {
        // Text-bearing attributes that should be transliterated
        case 'alt':
        case 'caption':
        case 'label':
        case 'title':
        case 'attribution':
          attrs[key] = typeof value === 'string' ? transliterate(value) : value;
          break;
        // Everything else preserved as-is (ids, enums, numbers, hrefs)
        default:
          attrs[key] = value;
          break;
      }
    }
    result.attrs = attrs;
  }

  // Recurse into content
  if (node.content) {
    result.content = node.content.map(transliterateNode);
  }

  return result;
}

/**
 * Transliterate an entire content document to Serbian Cyrillic.
 *
 * Returns a new document; the original is not mutated.
 * Text nodes, alt, caption, label, title, attribution and CTA labels
 * are transliterated. Ids, hrefs, marks, enums and numbers are preserved.
 */
export function transliterateDocument(
  doc: ContentDocument,
  _target: 'sr-Cyrl',
): ContentDocument {
  const content = (doc.content as unknown as RawNode[]).map(transliterateNode);
  return {
    type: 'doc',
    schemaVersion: doc.schemaVersion,
    content: content as unknown as ContentDocument['content'],
  };
}
