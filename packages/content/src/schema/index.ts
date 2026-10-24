// ---------------------------------------------------------------------------
// Content document schema, validation, canonicalization and transliteration
// Exported from @nestself/content/schema
//
// Public surface only — internal sub-schemas (individual mark schemas,
// inline node schemas, href schema, capability/media-kind schemas) are
// not re-exported. Consumers use BlockNodeSchema or the typed unions.
// ---------------------------------------------------------------------------

// --- Block catalogue, schemas and types (C-05, I14) ---
export {
  // Schemas — public surface
  ContentIdSchema,
  LinkHrefSchema,
  MarkSchema,
  SectionHeadingSchema,
  ParagraphSchema,
  ListItemSchema,
  BulletListSchema,
  OrderedListSchema,
  QuoteSchema,
  ImageSchema,
  ProfessionalNoteSchema,
  PracticalStepSchema,
  ChecklistItemSchema,
  ChecklistSchema,
  ApprovedMediaSchema,
  TranscriptSchema,
  RelatedResourceSchema,
  CtaSchema,
  BlockNodeSchema,
  // Constants
  CTA_KINDS,
  MEDIA_KINDS,
  CONTENT_CAPABILITIES,
  // Types (I14: typed unions for the renderer)
  type Mark,
  type CtaKind,
  type MediaKind,
  type ContentCapability,
  type TextNode,
  type HardBreak,
  type InlineNode,
  type SectionHeading,
  type Paragraph,
  type ListItem,
  type BulletList,
  type OrderedList,
  type Quote,
  type Image,
  type ProfessionalNote,
  type PracticalStep,
  type ChecklistItem,
  type Checklist,
  type ApprovedMedia,
  type Transcript,
  type RelatedResource,
  type Cta,
  type BlockNode,
} from './blocks.ts';

// --- ContentDocument schema (FMT-R-01) ---
export {
  ContentDocumentSchema,
  type ContentDocument,
  CURRENT_SCHEMA_VERSION,
  MAX_DOCUMENT_SIZE,
  MAX_NODES,
  MAX_RELATED_RESOURCES,
  MAX_CTAS,
  MAX_PROFESSIONAL_NOTES,
  MAX_PRACTICAL_STEPS,
  MAX_HEADING_TEXT,
  MAX_PARAGRAPH_TEXT,
  MAX_TRANSCRIPT_TEXT,
} from './document.ts';

// --- Two-layer validation (FMT-R-07) ---
export {
  validateContentDocument,
  type ContentErrorCode,
  type ValidationError,
  type ValidationResult,
  type ValidationOptions,
} from './validate.ts';

// --- Tiptap extensions (React-free, for ProseMirror schema) ---
export { extensions } from './extensions.ts';

// --- Canonicalization and approval hash (FMT-R-08, FMT-R-09) ---
export {
  canonicalize,
  approvalHash,
  HASH_FORMAT_VERSION,
  type ApprovalHashInput,
} from './canonicalize.ts';

// --- Schema migration (FMT-R-20, FMT-R-21) ---
export { migrateDocument } from './migrate.ts';

// --- Transliteration (FMT-R-26, C-28) ---
export { transliterateText, transliterateDocument } from './transliterate.ts';
