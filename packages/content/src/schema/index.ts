// ---------------------------------------------------------------------------
// Content document schema, validation, canonicalization and transliteration
// Exported from @nestself/content/schema
// ---------------------------------------------------------------------------

// --- Block catalogue and types (C-05) ---
export {
  BoldMarkSchema,
  ItalicMarkSchema,
  LinkMarkSchema,
  MarkSchema,
  type Mark,
  CTA_KINDS,
  CtaKindSchema,
  type CtaKind,
  MEDIA_KINDS,
  MediaKindSchema,
  type MediaKind,
  TextNodeSchema,
  type TextNode,
  HardBreakNodeSchema,
  InlineNodeSchema,
  type InlineNode,
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
  type ApprovalHashInput,
} from './canonicalize.ts';

// --- Schema migration (FMT-R-20, FMT-R-21) ---
export { migrateDocument } from './migrate.ts';

// --- Transliteration (FMT-R-26, C-28) ---
export { transliterateText, transliterateDocument } from './transliterate.ts';
