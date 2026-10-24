/**
 * Two-layer content document validation (FMT-R-07).
 *
 * Layer 1: Zod schema validation — types, attributes, ranges, marks,
 *          counts, link rules, size limit. Unknown keys are rejected
 *          by z.strictObject (never stripped).
 * Layer 2: ProseMirror structural validation — content expressions,
 *          nesting rules that Zod's flat array validation cannot express.
 *
 * Both layers run in Node.js without a DOM (confirmed: prosemirror-model
 * runs server-side).
 *
 * **Important**: The ProseMirror layer runs on `parsed.data` (the Zod
 * output), not the raw input. Callers must persist `result.document`
 * — never the original input — to guarantee all invariants hold.
 */
import { getSchema } from '@tiptap/core';
import { Node as PmNode } from '@tiptap/pm/model';

import {
  type ContentDocument,
  ContentDocumentSchema,
  CURRENT_SCHEMA_VERSION,
  MAX_CTAS,
  MAX_DOCUMENT_SIZE,
  MAX_HEADING_TEXT,
  MAX_PARAGRAPH_TEXT,
  MAX_PRACTICAL_STEPS,
  MAX_PROFESSIONAL_NOTES,
  MAX_RELATED_RESOURCES,
  MAX_TRANSCRIPT_TEXT,
} from './document.ts';
import { extensions } from './extensions.ts';

// ---------------------------------------------------------------------------
// Error codes (Appendix B Part B)
// ---------------------------------------------------------------------------

export type ContentErrorCode =
  | 'content_invalid_block'
  | 'content_invalid_link'
  | 'content_too_large'
  | 'content_missing_required'
  | 'content_schema_version';

export interface ValidationError {
  code: ContentErrorCode;
  message: string;
  /** JSON-pointer-style path to the offending node, e.g. "content.3". */
  path?: string;
}

export type ValidationResult =
  | { ok: true; document: ContentDocument }
  | { ok: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ValidationOptions {
  /**
   * Allowed hosts for `https:` links (FMT-R-06).
   * Entries are normalized to lowercase punycode via `new URL()`.
   * An empty list means no external links are permitted.
   */
  linkHostAllowlist?: string[];
}

// ---------------------------------------------------------------------------
// Typed node accessor
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

// ---------------------------------------------------------------------------
// Content-level validation rules that Zod schemas alone cannot express
// ---------------------------------------------------------------------------

function validateDocumentRules(
  doc: ContentDocument,
  options: ValidationOptions,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const content = doc.content as unknown as RawNode[];

  // --- Schema version check (I7, I8) ---
  if (doc.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push({
      code: 'content_schema_version',
      message: `Writes require schemaVersion ${CURRENT_SCHEMA_VERSION}; got ${doc.schemaVersion}. Use migrateDocument() for reads of older versions.`,
    });
    return errors; // bail early
  }

  // --- Size check (FMT-R-02, R3) — UTF-8 bytes ---
  const jsonUtf8Size = new TextEncoder().encode(JSON.stringify(doc)).length;
  if (jsonUtf8Size > MAX_DOCUMENT_SIZE) {
    errors.push({
      code: 'content_too_large',
      message: `Document size ${jsonUtf8Size} UTF-8 bytes exceeds ${MAX_DOCUMENT_SIZE} byte limit.`,
    });
  }

  // --- Count constraints ---
  let ctaCount = 0;
  let relatedResourceCount = 0;
  let professionalNoteCount = 0;
  let practicalStepCount = 0;

  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;
    if (node.type === 'cta') ctaCount++;
    if (node.type === 'relatedResource') relatedResourceCount++;
    if (node.type === 'professionalNote') professionalNoteCount++;
    if (node.type === 'practicalStep') practicalStepCount++;
  }

  if (ctaCount > MAX_CTAS) {
    errors.push({
      code: 'content_invalid_block',
      message: `At most ${MAX_CTAS} CTA node is permitted; found ${ctaCount}.`,
    });
  }

  if (relatedResourceCount > MAX_RELATED_RESOURCES) {
    errors.push({
      code: 'content_invalid_block',
      message: `At most ${MAX_RELATED_RESOURCES} relatedResource nodes permitted; found ${relatedResourceCount}.`,
    });
  }

  if (professionalNoteCount > MAX_PROFESSIONAL_NOTES) {
    errors.push({
      code: 'content_invalid_block',
      message: `At most ${MAX_PROFESSIONAL_NOTES} professionalNote nodes permitted; found ${professionalNoteCount}.`,
    });
  }

  if (practicalStepCount > MAX_PRACTICAL_STEPS) {
    errors.push({
      code: 'content_invalid_block',
      message: `At most ${MAX_PRACTICAL_STEPS} practicalStep nodes permitted; found ${practicalStepCount}.`,
    });
  }

  // --- Text length constraints (I2) ---
  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;

    if (node.type === 'sectionHeading' && node.content) {
      const totalText = sumTextLength(node.content);
      if (totalText > MAX_HEADING_TEXT) {
        errors.push({
          code: 'content_invalid_block',
          message: `sectionHeading text at content.${i} is ${totalText} characters; max ${MAX_HEADING_TEXT}.`,
          path: `content.${i}`,
        });
      }
    }

    if (node.type === 'paragraph' && node.content) {
      const totalText = sumTextLength(node.content);
      if (totalText > MAX_PARAGRAPH_TEXT) {
        errors.push({
          code: 'content_invalid_block',
          message: `paragraph text at content.${i} is ${totalText} characters; max ${MAX_PARAGRAPH_TEXT}.`,
          path: `content.${i}`,
        });
      }
    }

    if (node.type === 'transcript' && node.content) {
      let transcriptText = 0;
      for (const para of node.content) {
        if (para.content) transcriptText += sumTextLength(para.content);
      }
      if (transcriptText > MAX_TRANSCRIPT_TEXT) {
        errors.push({
          code: 'content_invalid_block',
          message: `transcript text at content.${i} is ${transcriptText} characters; max ${MAX_TRANSCRIPT_TEXT}.`,
          path: `content.${i}`,
        });
      }
    }
  }

  // --- Transcript rules (FMT-R-23, C-05, 17) ---
  const seenTranscriptMedia = new Set<string>();
  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;

    // Orphan transcript: not preceded by matching approvedMedia
    if (node.type === 'transcript') {
      const mediaId = node.attrs?.mediaAssetId as string | undefined;
      const prev = content[i - 1];
      if (
        !prev ||
        prev.type !== 'approvedMedia' ||
        prev.attrs?.mediaAssetId !== mediaId
      ) {
        errors.push({
          code: 'content_missing_required',
          message: `Orphan transcript at content.${i}: must immediately follow an approvedMedia node with matching mediaAssetId.`,
          path: `content.${i}`,
        });
      }

      // Duplicate transcript for same media
      if (mediaId) {
        if (seenTranscriptMedia.has(mediaId)) {
          errors.push({
            code: 'content_invalid_block',
            message: `Duplicate transcript for mediaAssetId "${mediaId}" at content.${i}.`,
            path: `content.${i}`,
          });
        }
        seenTranscriptMedia.add(mediaId);
      }
    }

    // Audio/video must be followed by transcript
    if (node.type === 'approvedMedia') {
      const kind = node.attrs?.kind;
      if (kind === 'audio' || kind === 'video') {
        const next = content[i + 1];
        if (
          !next ||
          next.type !== 'transcript' ||
          next.attrs?.mediaAssetId !== node.attrs?.mediaAssetId
        ) {
          errors.push({
            code: 'content_missing_required',
            message: `approvedMedia node at content.${i} (kind: ${kind as string}) must be immediately followed by a transcript node with matching mediaAssetId.`,
            path: `content.${i}`,
          });
        }
      }
    }
  }

  // --- Link host allowlist validation (FMT-R-06, R4) ---
  const rawAllowlist = options.linkHostAllowlist ?? [];
  // Normalize allowlist entries to lowercase punycode via URL
  const allowlist = rawAllowlist.map((host) => {
    try {
      return new URL(`https://${host}`).hostname;
    } catch {
      return host.toLowerCase();
    }
  });

  walkRawNodes(doc as unknown as RawNode, (node, path) => {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'link' && mark.attrs?.href) {
          const href = mark.attrs.href as string;
          // Internal links pass without allowlist check
          if (/^nestself:content\/[A-Za-z0-9_-]{1,64}$/.test(href)) return;

          try {
            const url = new URL(href);
            if (url.protocol !== 'https:') {
              errors.push({
                code: 'content_invalid_link',
                message: `Invalid link href "${href}" at ${path}.`,
                path,
              });
              return;
            }
            if (!allowlist.includes(url.hostname)) {
              errors.push({
                code: 'content_invalid_link',
                message: `Link host "${url.hostname}" not on allowlist at ${path}.`,
                path,
              });
            }
          } catch {
            errors.push({
              code: 'content_invalid_link',
              message: `Invalid link href "${href}" at ${path}.`,
              path,
            });
          }
        }
      }
    }
  });

  return errors;
}

function sumTextLength(nodes: RawNode[]): number {
  let total = 0;
  for (const n of nodes) {
    if (n.type === 'text' && n.text) total += n.text.length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Tree walker
// ---------------------------------------------------------------------------

function walkRawNodes(
  node: RawNode,
  visitor: (node: RawNode, path: string) => void,
  path = '',
): void {
  visitor(node, path);
  if (node.content) {
    for (let i = 0; i < node.content.length; i++) {
      walkRawNodes(
        node.content[i]!,
        visitor,
        path ? `${path}.content.${i}` : `content.${i}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// ProseMirror schema (lazy singleton)
// ---------------------------------------------------------------------------

let _pmSchema: ReturnType<typeof getSchema> | null = null;

function getPmSchema() {
  if (!_pmSchema) {
    _pmSchema = getSchema(extensions);
  }
  return _pmSchema;
}

// ---------------------------------------------------------------------------
// Error code mapping (I13)
// ---------------------------------------------------------------------------

/**
 * Map Zod issue codes and paths to ContentErrorCode.
 * Uses Zod issue code and path, never English message text.
 */
function inferErrorCode(issue: { code: string; path: PropertyKey[] }): ContentErrorCode {
  const pathStr = issue.path.map(String).join('.');

  // Link-related paths
  if (pathStr.includes('href') || pathStr.includes('marks')) {
    return 'content_invalid_link';
  }

  // Size issues
  if (issue.code === 'too_big') {
    return 'content_too_large';
  }

  return 'content_invalid_block';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a content document through both layers (FMT-R-07).
 *
 * Layer 1 (Zod): structural types, attribute types/ranges, mark types,
 * text lengths, node counts, link href form, unknown key rejection.
 *
 * Layer 2 (ProseMirror): content expression validation — catches nesting
 * violations that Zod's flat array validation cannot express (e.g. a
 * listItem directly inside a quote).
 *
 * **Callers must persist `result.document`, not the raw input.**
 * The document is the Zod-parsed output with all invariants enforced.
 */
export function validateContentDocument(
  doc: unknown,
  options: ValidationOptions = {},
): ValidationResult {
  // --- Layer 1: Zod ---
  const parsed = ContentDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    const errors: ValidationError[] = parsed.error.issues.map((issue) => ({
      code: inferErrorCode(issue),
      message: issue.message,
      path: issue.path.map(String).join('.'),
    }));
    return { ok: false, errors };
  }

  // Cast to our typed interface (I14)
  const document = parsed.data as unknown as ContentDocument;

  // --- Content-level rules ---
  const ruleErrors = validateDocumentRules(document, options);
  if (ruleErrors.length > 0) {
    return { ok: false, errors: ruleErrors };
  }

  // --- Layer 2: ProseMirror structural validation ---
  // Runs on parsed.data (Zod output), never the raw input (C2).
  try {
    const schema = getPmSchema();
    const pmNode = PmNode.fromJSON(schema, parsed.data as Record<string, unknown>);
    pmNode.check();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [
        {
          code: 'content_invalid_block',
          message: `ProseMirror structural validation failed: ${message}`,
        },
      ],
    };
  }

  return { ok: true, document };
}
