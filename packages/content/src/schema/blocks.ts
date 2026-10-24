/**
 * Block catalogue for the ContentDocument schema.
 *
 * Defines Zod schemas for every node type permitted by C-05.
 * Only the types listed here are valid; any other type is rejected
 * with error code `content_invalid_block` (FMT-R-03).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Marks (C-05: bold, italic, link only)
// ---------------------------------------------------------------------------

export const BoldMarkSchema = z.object({ type: z.literal('bold') });
export const ItalicMarkSchema = z.object({ type: z.literal('italic') });
export const LinkMarkSchema = z.object({
  type: z.literal('link'),
  attrs: z.object({ href: z.string() }),
});

export const MarkSchema = z.discriminatedUnion('type', [
  BoldMarkSchema,
  ItalicMarkSchema,
  LinkMarkSchema,
]);
export type Mark = z.infer<typeof MarkSchema>;

// ---------------------------------------------------------------------------
// CTA catalogue (FMT-R-04, C-05)
// ---------------------------------------------------------------------------

export const CTA_KINDS = [
  'open_content',
  'open_collection',
  'suggest_topic',
  'ask_general_question',
  'express_event_interest',
  'open_service',
] as const;
export const CtaKindSchema = z.enum(CTA_KINDS);
export type CtaKind = z.infer<typeof CtaKindSchema>;

// ---------------------------------------------------------------------------
// Media kind (C-05: audio, video, pdf)
// ---------------------------------------------------------------------------

export const MEDIA_KINDS = ['audio', 'video', 'pdf'] as const;
export const MediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKindSchema>;

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export const TextNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(5_000),
  marks: z.array(MarkSchema).optional(),
});
export type TextNode = z.infer<typeof TextNodeSchema>;

export const HardBreakNodeSchema = z.object({
  type: z.literal('hardBreak'),
});

export const InlineNodeSchema = z.discriminatedUnion('type', [
  TextNodeSchema,
  HardBreakNodeSchema,
]);
export type InlineNode = z.infer<typeof InlineNodeSchema>;

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

export const SectionHeadingSchema = z.object({
  type: z.literal('sectionHeading'),
  attrs: z.object({
    level: z.union([z.literal(2), z.literal(3)]),
  }),
  content: z.array(InlineNodeSchema).optional(),
});

export const ParagraphSchema = z.object({
  type: z.literal('paragraph'),
  content: z.array(InlineNodeSchema).optional(),
});

// List nodes are mutually recursive: listItem → (paragraph|bulletList|orderedList),
// bulletList/orderedList → listItem. We use z.lazy() to break the cycle.

// Forward-declare list schemas so ListItem can reference them.
type ListItemType = z.infer<typeof ListItemSchema>;

export const ListItemSchema: z.ZodType<{
  type: 'listItem';
  content: Array<
    | z.infer<typeof ParagraphSchema>
    | { type: 'bulletList'; content: ListItemType[] }
    | { type: 'orderedList'; attrs?: { start?: number }; content: ListItemType[] }
  >;
}> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    content: z.array(
      z.union([ParagraphSchema, BulletListSchema, OrderedListSchema]),
    ).min(1),
  }),
);

export const BulletListSchema: z.ZodType<{
  type: 'bulletList';
  content: ListItemType[];
}> = z.lazy(() =>
  z.object({
    type: z.literal('bulletList'),
    content: z.array(ListItemSchema).min(1).max(20),
  }),
);

export const OrderedListSchema: z.ZodType<{
  type: 'orderedList';
  attrs?: { start?: number };
  content: ListItemType[];
}> = z.lazy(() =>
  z.object({
    type: z.literal('orderedList'),
    attrs: z.object({ start: z.number().int().optional() }).optional(),
    content: z.array(ListItemSchema).min(1).max(20),
  }),
);

export const QuoteSchema = z.object({
  type: z.literal('quote'),
  attrs: z.object({
    attribution: z.string().max(200).optional(),
  }).optional(),
  content: z.array(ParagraphSchema).min(1),
});

export const ImageSchema = z.object({
  type: z.literal('image'),
  attrs: z.object({
    mediaAssetId: z.string().min(1),
    alt: z.string().max(300),
    caption: z.string().max(500).optional(),
  }),
});

export const ProfessionalNoteSchema = z.object({
  type: z.literal('professionalNote'),
  attrs: z.object({
    noteKind: z.enum(['warning', 'tip', 'disclaimer']),
  }),
  content: z.array(ParagraphSchema).min(1),
});

export const PracticalStepSchema = z.object({
  type: z.literal('practicalStep'),
  attrs: z.object({
    stepNumber: z.number().int().min(1),
    title: z.string().max(200),
  }),
  content: z.array(ParagraphSchema).min(1),
});

export const ChecklistItemSchema = z.object({
  type: z.literal('checklistItem'),
  attrs: z.object({
    label: z.string().max(300),
  }),
  content: z.array(InlineNodeSchema).optional(),
});

export const ChecklistSchema = z.object({
  type: z.literal('checklist'),
  content: z.array(ChecklistItemSchema).min(1).max(20),
});

export const ApprovedMediaSchema = z.object({
  type: z.literal('approvedMedia'),
  attrs: z.object({
    mediaAssetId: z.string().min(1),
    kind: MediaKindSchema,
    caption: z.string().max(500).optional(),
  }),
});

export const TranscriptSchema = z.object({
  type: z.literal('transcript'),
  attrs: z.object({
    mediaAssetId: z.string().min(1),
  }),
  content: z.array(ParagraphSchema).min(1),
});

export const RelatedResourceSchema = z.object({
  type: z.literal('relatedResource'),
  attrs: z.object({
    contentResourceId: z.string().min(1),
  }),
});

export const CtaSchema = z.object({
  type: z.literal('cta'),
  attrs: z.object({
    ctaKind: CtaKindSchema,
    targetId: z.string().optional(),
    label: z.string().max(100).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Block node union (all node types permitted as direct children of doc)
// ---------------------------------------------------------------------------

/**
 * Union of all node types that may appear as direct children of the
 * document node. HardBreak is intentionally excluded: ProseMirror
 * forbids mixing inline and block content at the doc level, and
 * hardBreak belongs inside paragraphs and other inline contexts.
 */
export const BlockNodeSchema: z.ZodType = z.lazy(() =>
  z.union([
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
  ]),
);
