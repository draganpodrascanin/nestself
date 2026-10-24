/**
 * Content document transliteration (FMT-R-26, C-28).
 *
 * `transliterateText(text)` converts Serbian Latin text to Cyrillic.
 *
 * `transliterateDocument(doc, 'sr-Cyrl')` produces a Cyrillic copy of
 * a ContentDocument by transliterating reader-visible text: text nodes,
 * alt text, captions, CTA labels, transcript text and link text inside
 * marks. It leaves ids, hrefs, mediaAssetId, contentResourceId, marks
 * structure and schemaVersion untouched.
 *
 * The transliteration core is shared with the i18n build script
 * (packages/i18n/scripts/transliterate.mjs) through a single .mjs
 * implementation in this directory.
 */
import { transliterate } from './transliterate-core.mjs';

import type { ContentDocument } from './document.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transliterate a single string from Serbian Latin to Cyrillic.
 *
 * Preserves {{placeholders}}, <html-tags>, URLs, and protected terms
 * (NestSelf, Pexels, etc.).
 */
export function transliterateText(text: string): string {
  return transliterate(text);
}

/**
 * Produce a Cyrillic copy of a ContentDocument.
 *
 * Only `'sr-Cyrl'` is supported as the target locale. The function
 * is pure and deterministic.
 *
 * **What is transliterated (reader-visible text):**
 * - Text node `.text` values
 * - `sectionHeading` text content
 * - `image.attrs.alt` and `image.attrs.caption`
 * - `approvedMedia.attrs.caption`
 * - `quote.attrs.attribution`
 * - `practicalStep.attrs.title`
 * - `checklistItem.attrs.label`
 * - `cta.attrs.label`
 * - Transcript paragraph text
 *
 * **What is NOT transliterated (structural/reference data):**
 * - `schemaVersion`, `type` fields
 * - All `id` fields (`mediaAssetId`, `contentResourceId`)
 * - `href` values in link marks
 * - Mark `type` fields (`bold`, `italic`, `link`)
 * - `ctaKind`, `noteKind`, `kind` enums
 * - `stepNumber`, `start` numbers
 */
export function transliterateDocument(
  doc: ContentDocument,
  _locale: 'sr-Cyrl',
): ContentDocument {
  return transliterateNode(doc) as ContentDocument;
}

// ---------------------------------------------------------------------------
// Internal tree walker
// ---------------------------------------------------------------------------

type AnyNode = Record<string, unknown>;

function transliterateNode(node: AnyNode): AnyNode {
  const result: AnyNode = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'schemaVersion') {
      // Structural: pass through unchanged
      result[key] = value;
    } else if (key === 'text' && typeof value === 'string') {
      // Text node content: transliterate
      result[key] = transliterate(value);
    } else if (key === 'marks' && Array.isArray(value)) {
      // Marks: pass through unchanged (preserve structure, type, href)
      result[key] = value;
    } else if (key === 'attrs' && typeof value === 'object' && value !== null) {
      result[key] = transliterateAttrs(
        node.type as string,
        value as Record<string, unknown>,
      );
    } else if (key === 'content' && Array.isArray(value)) {
      result[key] = value.map((child: AnyNode) => transliterateNode(child));
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Transliterate selected attributes based on the node type.
 * Ids, hrefs, enums and numbers pass through unchanged.
 */
function transliterateAttrs(
  nodeType: string,
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...attrs };

  switch (nodeType) {
    case 'sectionHeading':
      // level is a number: unchanged
      break;

    case 'image':
      // mediaAssetId: unchanged; alt and caption: transliterate
      if (typeof result.alt === 'string') result.alt = transliterate(result.alt);
      if (typeof result.caption === 'string') result.caption = transliterate(result.caption);
      break;

    case 'approvedMedia':
      // mediaAssetId, kind: unchanged; caption: transliterate
      if (typeof result.caption === 'string') result.caption = transliterate(result.caption);
      break;

    case 'quote':
      // attribution: transliterate
      if (typeof result.attribution === 'string') {
        result.attribution = transliterate(result.attribution);
      }
      break;

    case 'professionalNote':
      // noteKind: unchanged (enum)
      break;

    case 'practicalStep':
      // stepNumber: unchanged; title: transliterate
      if (typeof result.title === 'string') result.title = transliterate(result.title);
      break;

    case 'checklistItem':
      // label: transliterate
      if (typeof result.label === 'string') result.label = transliterate(result.label);
      break;

    case 'cta':
      // ctaKind, targetId: unchanged; label: transliterate
      if (typeof result.label === 'string') result.label = transliterate(result.label);
      break;

    case 'transcript':
      // mediaAssetId: unchanged (transcript text is in content paragraphs)
      break;

    case 'relatedResource':
      // contentResourceId: unchanged
      break;

    case 'orderedList':
      // start: unchanged (number)
      break;

    default:
      // paragraph, bulletList, checklist, listItem, hardBreak:
      // no attrs to transliterate
      break;
  }

  return result;
}
