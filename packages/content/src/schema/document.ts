/**
 * ContentDocument Zod schema (FMT-R-01).
 *
 * Validates the top-level structure of a content document JSON.
 * Imported by the API for every write (draft save, submit, publish)
 * and by canonicalize() for approval hashing (C-03, C-06).
 */
import { z } from 'zod';

import { type BlockNode, BlockNodeSchema } from './blocks.ts';

/**
 * The current schema version. Increment when the block catalogue
 * changes (FMT-R-20).
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Maximum canonical JSON size in UTF-8 bytes (FMT-R-02, R3).
 */
export const MAX_DOCUMENT_SIZE = 204_800; // 200 KB

/**
 * Maximum number of direct child nodes (C-05).
 */
export const MAX_NODES = 400;

/**
 * Maximum number of relatedResource nodes per document (C-05).
 */
export const MAX_RELATED_RESOURCES = 3;

/**
 * Maximum number of CTA nodes per document (C-05, FMT-R-05).
 */
export const MAX_CTAS = 1;

/**
 * Maximum number of professionalNote nodes per document.
 */
export const MAX_PROFESSIONAL_NOTES = 3;

/**
 * Maximum number of practicalStep nodes per document.
 */
export const MAX_PRACTICAL_STEPS = 20;

/**
 * Maximum characters in a sectionHeading's combined text (I2).
 */
export const MAX_HEADING_TEXT = 200;

/**
 * Maximum characters of combined text per paragraph (I2).
 */
export const MAX_PARAGRAPH_TEXT = 5_000;

/**
 * Maximum characters of combined text across a transcript's paragraphs (I2).
 */
export const MAX_TRANSCRIPT_TEXT = 20_000;

export const ContentDocumentSchema = z.strictObject({
  type: z.literal('doc'),
  schemaVersion: z.number().int().min(1),
  content: z.array(BlockNodeSchema).min(1).max(MAX_NODES),
});

/**
 * The fully typed content document. `content` is a typed union
 * of block nodes, not `unknown[]` (I14).
 */
export interface ContentDocument {
  type: 'doc';
  schemaVersion: number;
  content: BlockNode[];
}
