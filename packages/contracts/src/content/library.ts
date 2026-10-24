/**
 * Library response contract schemas (9.15, T-C1.11).
 *
 * Detail, card, list and saved-item schemas for the employee library
 * experience. Error codes used by library endpoints.
 */
import { z } from 'zod';
import { ContentTypeSchema } from './cms.js';
import { ContentLocaleSchema } from './media.js';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

export type ContentLocale = z.infer<typeof ContentLocaleSchema>;

export const DurationBandSchema = z.enum(['under_5', '5_to_15', 'over_15']);
export type DurationBand = z.infer<typeof DurationBandSchema>;

export const CategorySummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  label: z.string(),
  description: z.string().nullable(),
});

export const TopicSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const SourceSchema = z.object({
  label: z.string(),
  url: z.string().nullable(),
});

export const MediaRenditionRefSchema = z.object({
  kind: z.string(),
  mimeType: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});

export const MediaReferenceSummarySchema = z.object({
  assetId: z.string(),
  kind: z.string(),
  renditions: z.array(MediaRenditionRefSchema),
  width: z.number().nullable(),
  height: z.number().nullable(),
  focalPoint: z.object({ x: z.number(), y: z.number() }).nullable(),
  altText: z.string().nullable(),
});

export const RelatedResourceSummarySchema = z.object({
  resourceId: z.string(),
  type: ContentTypeSchema,
  title: z.string(),
  summary: z.string(),
  categoryName: z.string(),
  coverImageUrl: z.string().nullable(),
});

export const CtaSummarySchema = z.object({
  kind: z.string(),
  label: z.string(),
  target: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Content detail read model (9.6, LIB-R-22)
// ---------------------------------------------------------------------------

export const LibraryContentDetailSchema = z.object({
  id: z.string(),
  type: ContentTypeSchema,
  locale: ContentLocaleSchema,
  title: z.string(),
  summary: z.string(),
  outcome: z.string(),
  body: z.unknown(),
  durationSeconds: z.number().nullable(),
  durationBand: DurationBandSchema.nullable(),
  difficulty: z.string().nullable(),
  category: CategorySummarySchema,
  secondaryCategories: z.array(CategorySummarySchema),
  topics: z.array(TopicSummarySchema),
  authorName: z.string(),
  reviewerName: z.string().nullable(),
  reviewedAt: z.coerce.date().nullable(),
  sources: z.array(SourceSchema),
  media: z.array(MediaReferenceSummarySchema),
  relatedResources: z.array(RelatedResourceSummarySchema).max(3),
  cta: CtaSummarySchema.nullable(),
  availableLocales: z.array(ContentLocaleSchema),
  saved: z.boolean(),
  playbackPosition: z.number().nullable(),
});
export type LibraryContentDetail = z.infer<typeof LibraryContentDetailSchema>;

// ---------------------------------------------------------------------------
// Content card (9.15, LIB-R-41)
// ---------------------------------------------------------------------------

export const LibraryCardSchema = z.object({
  resourceId: z.string(),
  type: ContentTypeSchema,
  locale: ContentLocaleSchema,
  title: z.string(),
  summary: z.string(),
  categoryName: z.string(),
  durationBand: DurationBandSchema.nullable(),
  coverImageUrl: z.string().nullable(),
  saved: z.boolean(),
});
export type LibraryCard = z.infer<typeof LibraryCardSchema>;

// ---------------------------------------------------------------------------
// Content list (9.3, LIB-R-12)
// ---------------------------------------------------------------------------

export const LibraryContentListSchema = z.object({
  items: z.array(LibraryCardSchema),
  nextCursor: z.string().nullable(),
});
export type LibraryContentList = z.infer<typeof LibraryContentListSchema>;

export const LibraryContentListQuerySchema = z.object({
  categoryId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type LibraryContentListQuery = z.infer<typeof LibraryContentListQuerySchema>;

// ---------------------------------------------------------------------------
// Saved items (9.7, 9.10, 9.15)
// ---------------------------------------------------------------------------

export const SavedItemSchema = z.object({
  resourceId: z.string(),
  type: ContentTypeSchema.nullable(),
  title: z.string().nullable(),
  status: z.enum(['available', 'unavailable']),
  categoryName: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  savedAt: z.coerce.date(),
});
export type SavedItem = z.infer<typeof SavedItemSchema>;

export const SavedItemsListSchema = z.object({
  items: z.array(SavedItemSchema),
  nextCursor: z.string().nullable(),
});
export type SavedItemsList = z.infer<typeof SavedItemsListSchema>;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const LIBRARY_ERROR_CODES = [
  'content_not_available',
  'invalid_context',
] as const;

export type LibraryErrorCode = (typeof LIBRARY_ERROR_CODES)[number];
