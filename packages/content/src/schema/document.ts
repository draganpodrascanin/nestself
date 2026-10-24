/**
 * ContentDocument Zod schema (FMT-R-01).
 *
 * Validates the top-level structure of a content document JSON.
 * Imported by the API for every write (draft save, submit, publish)
 * and by canonicalize() for approval hashing (C-03, C-06).
 */
import { z } from 'zod';

import { BlockNodeSchema } from './blocks.ts';

/**
 * The current schema version. Increment when the block catalogue
 * changes (FMT-R-20).
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Maximum canonical JSON size in bytes (FMT-R-02).
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

export const ContentDocumentSchema = z.object({
  type: z.literal('doc'),
  schemaVersion: z.number().int().min(1),
  content: z.array(BlockNodeSchema).min(1).max(MAX_NODES),
});

export type ContentDocument = z.infer<typeof ContentDocumentSchema>;
