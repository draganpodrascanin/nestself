/**
 * Block catalogue for the ContentDocument schema.
 *
 * Defines Zod schemas for every node type permitted by C-05.
 * Only the types listed here are valid; any other type is rejected
 * with error code `content_invalid_block` (FMT-R-03).
 *
 * Design choices:
 * - Every object uses z.strictObject to reject unknown keys (C2).
 * - Optional attributes accept null via .nullable() to match
 *   ProseMirror's toJSON() output (C1).
 * - Lists are non-recursive for exactly two nesting levels (I3).
 * - Discriminated unions on 'type' for better error messages (I13).
 * - ContentIdSchema validates all identifiers (I5).
 * - CTA is a discriminated union on 'ctaKind' (I6).
 * - Link hrefs are validated at the Zod layer (I3/I4, R4).
 */
import { CONTENT_CAPABILITIES, type ContentCapability } from '@nestself/contracts';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Content identifier schema (I5)
// ---------------------------------------------------------------------------

/**
 * Validates identifiers for media assets, content resources, CTA targets.
 * Pattern: 1-64 alphanumeric characters, hyphens and underscores.
 * Rejects URL-looking strings.
 */
export const ContentIdSchema = z.string().regex(
  /^[A-Za-z0-9_-]{1,64}$/,
  'Content identifiers must be 1-64 alphanumeric characters, hyphens or underscores.',
);

// ---------------------------------------------------------------------------
// Link href schema (I3/I4, R4)
// ---------------------------------------------------------------------------

/**
 * Whitespace and control character pattern (including U+00A0).
 * Used to reject hrefs containing any whitespace or control characters.
 */
// eslint-disable-next-line no-control-regex -- intentionally matching control characters in link hrefs
const WHITESPACE_OR_CONTROL_RE = /[\s\x00-\x1f\x7f\u00a0]/;

/**
 * Internal content reference: `nestself:content/<ContentId>`.
 */
const INTERNAL_LINK_RE = /^nestself:content\/[A-Za-z0-9_-]{1,64}$/;

/**
 * Non-ASCII character pattern.
 * Used to reject hrefs containing any non-ASCII byte — IDN hosts must
 * be given in punycode (T-C1.06 hardening item b).
 */
// eslint-disable-next-line no-control-regex -- intentionally matching all non-ASCII
const NON_ASCII_RE = /[^\x00-\x7f]/;

// ---------------------------------------------------------------------------
// Pure href predicate (used by both Zod and the renderer — item 8)
// ---------------------------------------------------------------------------

/**
 * Returns true when `href` is safe to use as a link target.
 *
 * Accepted forms:
 * - `nestself:content/<ContentId>` (internal content links)
 * - `https://<host>/<path>` with:
 *   - literal `https://` prefix (rejects `https:host`, `HTTPS://`)
 *   - non-empty hostname (rejects `https:///path`)
 *   - ASCII-only authority (scheme + host; IDN must be punycode)
 *   - no userinfo, no non-default port
 *   - no whitespace or control characters anywhere
 *   - path/query/fragment may contain percent-encoded non-ASCII
 *     (the editor percent-encodes on paste)
 *
 * This single predicate is the source of truth: the Zod `LinkHrefSchema`
 * refine delegates here, and `safe-href.ts` re-exports it for the renderer.
 */
export function isValidHref(href: string): boolean {
  // Reject non-strings defensively
  if (typeof href !== 'string' || href.length === 0) return false;

  // Reject whitespace and control characters (including U+00A0)
  if (WHITESPACE_OR_CONTROL_RE.test(href)) return false;

  // Accept internal content links
  if (INTERNAL_LINK_RE.test(href)) return true;

  // Must literally start with 'https://' (T-C1.06 hardening a).
  // Rejects 'https:host', 'HTTPS://', 'https:///path'.
  if (!href.startsWith('https://')) return false;

  // The authority portion of the raw input (between 'https://' and the next
  // '/', '?', or '#') must be ASCII-only. This catches full-width lookalikes,
  // zero-width characters and Cyrillic homoglyphs in the host before URL
  // parsing normalizes them away (e.g. ｅxample.com → example.com).
  // Paths may contain percent-encoded non-ASCII; the editor encodes on paste.
  const authorityEnd = href.indexOf('/', 8); // 8 = 'https://'.length
  const rawAuthority = authorityEnd === -1 ? href.slice(8) : href.slice(8, authorityEnd);
  if (NON_ASCII_RE.test(rawAuthority)) return false;

  try {
    const url = new URL(href);
    if (url.protocol !== 'https:') return false;
    // Must have a non-empty hostname (rejects https:///path)
    if (!url.hostname) return false;
    // No userinfo
    if (url.username || url.password) return false;
    // No non-default port
    if (url.port !== '') return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Schema for link hrefs. Enforces:
 * - Non-empty (min 1)
 * - No whitespace or control characters (including U+00A0)
 * - Must be `https://...` or `nestself:content/<id>`
 * - HTTPS links: ASCII-only authority, no userinfo, no non-default port,
 *   non-empty hostname (T-C1.06 hardening)
 *
 * Delegates to `isValidHref` — the single source of truth for href
 * safety, shared with the renderer layer.
 *
 * The host allowlist is applied at runtime in validateContentDocument,
 * not in the base Zod schema (R4).
 */
export const LinkHrefSchema = z
  .string()
  .min(1, 'Link href must not be empty.')
  .refine(
    isValidHref,
    'Link href must be https:// (ASCII authority, no port, no userinfo) or nestself:content/<id>.',
  );

// ---------------------------------------------------------------------------
// Marks (C-05: bold, italic, link only)
// ---------------------------------------------------------------------------

export const BoldMarkSchema = z.strictObject({ type: z.literal('bold') });
export const ItalicMarkSchema = z.strictObject({ type: z.literal('italic') });
export const LinkMarkSchema = z.strictObject({
  type: z.literal('link'),
  attrs: z.strictObject({ href: LinkHrefSchema }),
});

export const MarkSchema = z.discriminatedUnion('type', [
  BoldMarkSchema,
  ItalicMarkSchema,
  LinkMarkSchema,
]);
export type Mark = z.infer<typeof MarkSchema>;

// ---------------------------------------------------------------------------
// CTA catalogue (FMT-R-04, C-05, I6)
// ---------------------------------------------------------------------------

export const CTA_KINDS = [
  'open_content',
  'open_collection',
  'suggest_topic',
  'ask_general_question',
  'express_event_interest',
  'open_service',
] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

/**
 * Content capability keys for the open_service CTA.
 * Shared from @nestself/contracts to match the content_capability DB enum (N2).
 */
export { CONTENT_CAPABILITIES };
export type { ContentCapability };
const ContentCapabilitySchema = z.enum(CONTENT_CAPABILITIES);

// ---------------------------------------------------------------------------
// Media kind (C-05: audio, video, pdf)
// ---------------------------------------------------------------------------

export const MEDIA_KINDS = ['audio', 'video', 'pdf'] as const;
export const MediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKindSchema>;

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export const TextNodeSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(5_000),
  marks: z.array(MarkSchema).optional(),
});
export type TextNode = z.infer<typeof TextNodeSchema>;

export const HardBreakNodeSchema = z.strictObject({
  type: z.literal('hardBreak'),
});
export type HardBreak = z.infer<typeof HardBreakNodeSchema>;

export const InlineNodeSchema = z.discriminatedUnion('type', [
  TextNodeSchema,
  HardBreakNodeSchema,
]);
export type InlineNode = z.infer<typeof InlineNodeSchema>;

// ---------------------------------------------------------------------------
// Inline content variants (R1)
// Paragraphs and checklistItems allow text and hardBreak;
// sectionHeadings only allow text (no hardBreak).
// ---------------------------------------------------------------------------

const ParagraphInlineSchema = z.discriminatedUnion('type', [
  TextNodeSchema,
  HardBreakNodeSchema,
]);

const HeadingInlineSchema = TextNodeSchema;

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

export const SectionHeadingSchema = z.strictObject({
  type: z.literal('sectionHeading'),
  attrs: z.strictObject({
    level: z.union([z.literal(2), z.literal(3)]),
  }),
  content: z.array(HeadingInlineSchema).optional(),
});
export type SectionHeading = z.infer<typeof SectionHeadingSchema>;

export const ParagraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(ParagraphInlineSchema).optional(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;

// ---------------------------------------------------------------------------
// Lists — non-recursive for exactly two nesting levels (I3)
// ---------------------------------------------------------------------------

/** Inner list items — no further nesting allowed. */
const InnerListItemSchema = z.strictObject({
  type: z.literal('listItem'),
  content: z.array(ParagraphSchema).min(1),
});

const InnerBulletListSchema = z.strictObject({
  type: z.literal('bulletList'),
  content: z.array(InnerListItemSchema).min(1).max(20),
});

const InnerOrderedListSchema = z.strictObject({
  type: z.literal('orderedList'),
  attrs: z.strictObject({ start: z.number().int().nullable() }).optional(),
  content: z.array(InnerListItemSchema).min(1).max(20),
});

/** Outer list items — may contain paragraph or one level of nested list. */
export const ListItemSchema = z.strictObject({
  type: z.literal('listItem'),
  content: z.array(
    z.union([ParagraphSchema, InnerBulletListSchema, InnerOrderedListSchema]),
  ).min(1),
});
export type ListItem = z.infer<typeof ListItemSchema>;

export const BulletListSchema = z.strictObject({
  type: z.literal('bulletList'),
  content: z.array(ListItemSchema).min(1).max(20),
});
export type BulletList = z.infer<typeof BulletListSchema>;

export const OrderedListSchema = z.strictObject({
  type: z.literal('orderedList'),
  attrs: z.strictObject({ start: z.number().int().nullable() }).optional(),
  content: z.array(ListItemSchema).min(1).max(20),
});
export type OrderedList = z.infer<typeof OrderedListSchema>;

export const QuoteSchema = z.strictObject({
  type: z.literal('quote'),
  attrs: z.strictObject({
    attribution: z.string().max(200).nullable(),
  }).optional(),
  content: z.array(ParagraphSchema).min(1),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const ImageSchema = z.strictObject({
  type: z.literal('image'),
  attrs: z.strictObject({
    mediaAssetId: ContentIdSchema,
    alt: z.string().max(300),
    caption: z.string().max(500).nullable().optional(),
  }),
});
export type Image = z.infer<typeof ImageSchema>;

export const ProfessionalNoteSchema = z.strictObject({
  type: z.literal('professionalNote'),
  attrs: z.strictObject({
    noteKind: z.enum(['warning', 'tip', 'disclaimer']),
  }),
  content: z.array(ParagraphSchema).min(1),
});
export type ProfessionalNote = z.infer<typeof ProfessionalNoteSchema>;

export const PracticalStepSchema = z.strictObject({
  type: z.literal('practicalStep'),
  attrs: z.strictObject({
    stepNumber: z.number().int().min(1),
    title: z.string().max(200),
  }),
  content: z.array(ParagraphSchema).min(1),
});
export type PracticalStep = z.infer<typeof PracticalStepSchema>;

export const ChecklistItemSchema = z.strictObject({
  type: z.literal('checklistItem'),
  attrs: z.strictObject({
    label: z.string().max(300),
  }),
  content: z.array(ParagraphInlineSchema).optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistSchema = z.strictObject({
  type: z.literal('checklist'),
  content: z.array(ChecklistItemSchema).min(1).max(20),
});
export type Checklist = z.infer<typeof ChecklistSchema>;

export const ApprovedMediaSchema = z.strictObject({
  type: z.literal('approvedMedia'),
  attrs: z.strictObject({
    mediaAssetId: ContentIdSchema,
    kind: MediaKindSchema,
    caption: z.string().max(500).nullable().optional(),
  }),
});
export type ApprovedMedia = z.infer<typeof ApprovedMediaSchema>;

export const TranscriptSchema = z.strictObject({
  type: z.literal('transcript'),
  attrs: z.strictObject({
    mediaAssetId: ContentIdSchema,
  }),
  content: z.array(ParagraphSchema).min(1),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const RelatedResourceSchema = z.strictObject({
  type: z.literal('relatedResource'),
  attrs: z.strictObject({
    contentResourceId: ContentIdSchema,
    /** Display title resolved when the author picks the resource. */
    contentResourceTitle: z.string().max(200).nullable().optional(),
  }),
});
export type RelatedResource = z.infer<typeof RelatedResourceSchema>;

// ---------------------------------------------------------------------------
// CTA — single strictObject, attrs discriminated on ctaKind (N4, I6)
// ---------------------------------------------------------------------------

const CtaLabel = z.string().max(100).nullable().optional();

/** Attrs discriminated union on ctaKind. */
const CtaAttrsSchema = z.discriminatedUnion('ctaKind', [
  z.strictObject({ ctaKind: z.enum(['open_content', 'open_collection']), targetId: ContentIdSchema, label: CtaLabel }),
  z.strictObject({ ctaKind: z.literal('open_service'), targetId: ContentCapabilitySchema, label: CtaLabel }),
  z.strictObject({ ctaKind: z.enum(['suggest_topic', 'ask_general_question', 'express_event_interest']), targetId: z.null().optional(), label: CtaLabel }),
]);

export const CtaSchema = z.strictObject({
  type: z.literal('cta'),
  attrs: CtaAttrsSchema,
});
export type Cta = z.infer<typeof CtaSchema>;

// ---------------------------------------------------------------------------
// Block node union — single discriminatedUnion on 'type' (N4, I13)
// HardBreak is inline-only and NOT included here (R1).
// ---------------------------------------------------------------------------

export const BlockNodeSchema = z.discriminatedUnion('type', [
  SectionHeadingSchema,
  ParagraphSchema,
  BulletListSchema,
  OrderedListSchema,
  QuoteSchema,
  ImageSchema,
  ProfessionalNoteSchema,
  PracticalStepSchema,
  ChecklistSchema,
  ApprovedMediaSchema,
  TranscriptSchema,
  RelatedResourceSchema,
  CtaSchema,
]);

/**
 * The typed union of all block nodes. Used by ContentDocument and
 * available for renderers (I14).
 */
export type BlockNode =
  | SectionHeading
  | Paragraph
  | BulletList
  | OrderedList
  | Quote
  | Image
  | ProfessionalNote
  | PracticalStep
  | Checklist
  | ApprovedMedia
  | Transcript
  | RelatedResource
  | Cta;
