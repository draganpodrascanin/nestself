/**
 * Two-layer content document validation (FMT-R-07).
 *
 * Layer 1: Zod schema validation — types, attributes, ranges, marks,
 *          counts, link rules, size limit.
 * Layer 2: ProseMirror structural validation — content expressions,
 *          nesting rules that Zod's flat array validation cannot express.
 *
 * Both layers run in Node.js without a DOM (confirmed: prosemirror-model
 * runs server-side).
 */
import { getSchema } from '@tiptap/core';
import { Node as PmNode } from '@tiptap/pm/model';

import {
  type ContentDocument,
  ContentDocumentSchema,
  MAX_CTAS,
  MAX_DOCUMENT_SIZE,
  MAX_RELATED_RESOURCES,
} from './document.ts';
import { extensions } from './extensions.ts';

// ---------------------------------------------------------------------------
// Error codes (Appendix B Part B)
// ---------------------------------------------------------------------------

export type ContentErrorCode =
  | 'content_invalid_block'
  | 'content_invalid_link'
  | 'content_too_large'
  | 'content_missing_required';

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
   * An empty list means no external links are permitted.
   */
  linkHostAllowlist?: string[];

  /**
   * Hook for CTA target availability checks (FMT-R-04).
   * The schema layer performs structural validation only;
   * target existence and capability checks happen in the API.
   */
  validateCtaTarget?: (ctaKind: string, targetId?: string) => Promise<ValidationError | null>;
}

// ---------------------------------------------------------------------------
// Internal link href pattern (FMT-R-06)
// ---------------------------------------------------------------------------

const INTERNAL_LINK_RE = /^nestself:content\/[a-zA-Z0-9_-]+$/;

// Scheme patterns to reject (case-insensitive, whitespace-trimmed).
const REJECTED_SCHEME_RE = /^\s*(javascript|data|http|vbscript|file)\s*:/i;
const PROTOCOL_RELATIVE_RE = /^\s*\/\//;

function validateHref(
  href: string,
  allowlist: string[],
): ContentErrorCode | null {
  const trimmed = href.trim();

  // Reject protocol-relative URLs
  if (PROTOCOL_RELATIVE_RE.test(trimmed)) return 'content_invalid_link';

  // Reject dangerous schemes (including mixed-case and whitespace-padded)
  if (REJECTED_SCHEME_RE.test(trimmed)) return 'content_invalid_link';

  // Internal reference
  if (INTERNAL_LINK_RE.test(trimmed)) return null;

  // https: with host on allowlist
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return 'content_invalid_link';
    if (!allowlist.includes(url.hostname)) return 'content_invalid_link';
    return null;
  } catch {
    return 'content_invalid_link';
  }
}

// ---------------------------------------------------------------------------
// Content-level validation rules that Zod schemas alone cannot express
// ---------------------------------------------------------------------------

/**
 * A typed accessor for doc content nodes. Since BlockNodeSchema uses
 * z.lazy() (losing inference), we work with the raw JSON shape here.
 */
interface RawNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

function validateDocumentRules(
  doc: ContentDocument,
  options: ValidationOptions,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const allowlist = options.linkHostAllowlist ?? [];
  const content = doc.content as unknown as RawNode[];

  // --- Size check (FMT-R-02) ---
  const jsonSize = JSON.stringify(doc).length;
  if (jsonSize > MAX_DOCUMENT_SIZE) {
    errors.push({
      code: 'content_too_large',
      message: `Document size ${jsonSize} bytes exceeds ${MAX_DOCUMENT_SIZE} byte limit.`,
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

  if (professionalNoteCount > 3) {
    errors.push({
      code: 'content_invalid_block',
      message: `At most 3 professionalNote nodes permitted; found ${professionalNoteCount}.`,
    });
  }

  if (practicalStepCount > 20) {
    errors.push({
      code: 'content_invalid_block',
      message: `At most 20 practicalStep nodes permitted; found ${practicalStepCount}.`,
    });
  }

  // --- Transcript-after-audio/video rule (FMT-R-23, C-05) ---
  //
  // Design choice: the media kind (audio/video/pdf) is NOT known from
  // the media_assets table at JSON validation time. Instead, the
  // approvedMedia node carries a `kind` attribute (per the spec table
  // in 6.2). Validation checks this attribute structurally: every
  // approvedMedia node with kind "audio" or "video" must be immediately
  // followed by a transcript node whose mediaAssetId matches.
  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;
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

  // --- Link validation (FMT-R-06) ---
  walkRawNodes(doc as unknown as RawNode, (node, path) => {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'link' && mark.attrs?.href) {
          const code = validateHref(
            mark.attrs.href as string,
            allowlist,
          );
          if (code) {
            errors.push({
              code,
              message: `Invalid link href "${mark.attrs.href as string}" at ${path}.`,
              path,
            });
          }
        }
      }
    }
  });

  // --- Extra/unknown attribute rejection ---
  // The closed Zod schema already strips unknown keys via strict objects.
  // ProseMirror layer 2 catches structural nesting violations.

  return errors;
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a content document through both layers (FMT-R-07).
 *
 * Layer 1 (Zod): structural types, attribute types/ranges, mark types,
 * text lengths, node counts.
 *
 * Layer 2 (ProseMirror): content expression validation — catches nesting
 * violations that Zod's flat array validation cannot express (e.g. a
 * listItem directly inside a quote).
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
      path: issue.path.join('.'),
    }));
    return { ok: false, errors };
  }

  const document = parsed.data;

  // --- Content-level rules ---
  const ruleErrors = validateDocumentRules(document, options);
  if (ruleErrors.length > 0) {
    return { ok: false, errors: ruleErrors };
  }

  // --- Layer 2: ProseMirror structural validation ---
  try {
    const schema = getPmSchema();
    const pmNode = PmNode.fromJSON(schema, doc as Record<string, unknown>);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferErrorCode(issue: { path: PropertyKey[]; message: string }): ContentErrorCode {
  const pathStr = issue.path.map(String).join('.');
  const msg = issue.message.toLowerCase();

  if (msg.includes('type') || msg.includes('invalid_union') || msg.includes('unrecognized')) {
    return 'content_invalid_block';
  }
  if (pathStr.includes('href') || msg.includes('link') || msg.includes('href')) {
    return 'content_invalid_link';
  }
  if (msg.includes('too_big') || msg.includes('size')) {
    return 'content_too_large';
  }
  return 'content_invalid_block';
}
