/**
 * Media contract schemas (MED-R-31, 8.15).
 *
 * Request and response schemas for media endpoints; error codes.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

export const MediaKindSchema = z.enum(['image', 'audio', 'video', 'captions', 'pdf']);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MediaAssetStateSchema = z.enum([
  'uploaded', 'quarantined', 'processing', 'ready', 'rejected', 'expired',
]);
export type MediaAssetState = z.infer<typeof MediaAssetStateSchema>;

export const MediaScanStatusSchema = z.enum([
  'pending', 'no_threats_found', 'threats_found',
  'unsupported', 'failed', 'not_scanned_local',
]);
export type MediaScanStatus = z.infer<typeof MediaScanStatusSchema>;

export const MediaLicenseKindSchema = z.enum(['owned', 'licensed', 'stock', 'generated']);
export type MediaLicenseKind = z.infer<typeof MediaLicenseKindSchema>;

export const MediaRenditionKindSchema = z.enum([
  'original', 'card_webp', 'card_jpeg', 'detail_webp', 'detail_jpeg',
  'poster_webp', 'audio', 'video', 'captions_vtt', 'pdf',
]);
export type MediaRenditionKind = z.infer<typeof MediaRenditionKindSchema>;

export const ContentLocaleSchema = z.enum(['sr-Latn', 'sr-Cyrl', 'hu', 'en']);

export type MediaStorageMode = 'local' | 's3';

// ---------------------------------------------------------------------------
// Upload metadata
// ---------------------------------------------------------------------------

export const MediaUploadMetadataSchema = z.object({
  kind: MediaKindSchema,
  ownerCategoryId: z.string().min(1),
  licenseKind: MediaLicenseKindSchema,
  licenseReference: z.string().max(500).nullable().optional(),
  consentReference: z.string().max(500).nullable().optional(),
  altText: z.record(z.string(), z.string().max(300)).optional(),
  focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});
export type MediaUploadMetadata = z.infer<typeof MediaUploadMetadataSchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  kind: MediaKindSchema,
  state: MediaAssetStateSchema,
  ownerCategoryId: z.string().min(1).nullable(),
  checksumSha256: z.string().nullable(),
  byteSize: z.number(),
  mimeType: z.string(),
  durationSeconds: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  scanStatus: MediaScanStatusSchema,
  licenseKind: MediaLicenseKindSchema.nullable(),
  licenseReference: z.string().nullable(),
  rightsExpiresAt: z.coerce.date().nullable(),
  consentReference: z.string().nullable(),
  altText: z.record(z.string(), z.string()).nullable(),
  focalPoint: z.object({ x: z.number(), y: z.number() }).nullable(),
  createdAt: z.coerce.date(),
  readyAt: z.coerce.date().nullable(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const MediaRenditionSchema = z.object({
  id: z.string().min(1),
  kind: MediaRenditionKindSchema,
  width: z.number().nullable(),
  height: z.number().nullable(),
  byteSize: z.number(),
  mimeType: z.string(),
});
export type MediaRendition = z.infer<typeof MediaRenditionSchema>;

export const MediaAssetDetailSchema = MediaAssetSchema.extend({
  renditions: z.array(MediaRenditionSchema),
});
export type MediaAssetDetail = z.infer<typeof MediaAssetDetailSchema>;

export const MediaAssetListSchema = z.object({
  items: z.array(MediaAssetSchema),
  nextCursor: z.string().nullable(),
});
export type MediaAssetList = z.infer<typeof MediaAssetListSchema>;

export const MediaAssetUpdateSchema = z.object({
  licenseKind: MediaLicenseKindSchema.optional(),
  licenseReference: z.string().max(500).nullable().optional(),
  consentReference: z.string().max(500).nullable().optional(),
  rightsExpiresAt: z.coerce.date().nullable().optional(),
  altText: z.record(z.string(), z.string().max(300)).optional(),
  focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).nullable().optional(),
});
export type MediaAssetUpdate = z.infer<typeof MediaAssetUpdateSchema>;

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

export const MediaListQuerySchema = z.object({
  kind: MediaKindSchema.optional(),
  state: MediaAssetStateSchema.optional(),
  ownerCategoryId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MediaListQuery = z.infer<typeof MediaListQuerySchema>;

// ---------------------------------------------------------------------------
// Error codes (8.14)
// ---------------------------------------------------------------------------

export const MEDIA_ERROR_CODES = [
  'media_type_rejected',
  'media_too_large',
  'media_not_ready',
  'media_rights_expired',
  'media_in_use',
  'content_not_available',
] as const;

export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Per-kind size limits (MED-R-04)
// ---------------------------------------------------------------------------

/** Maximum upload size in bytes, keyed by media kind. */
export const MEDIA_KIND_MAX_BYTES: Record<MediaKind, number> = {
  image: 15 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  video: 300 * 1024 * 1024,
  captions: 512 * 1024,
  pdf: 20 * 1024 * 1024,
};

/** Allowed MIME types per kind (verified by magic-byte sniffing). */
export const MEDIA_KIND_ALLOWED_MIMES: Record<MediaKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/mpeg', 'audio/mp4'],
  video: ['video/mp4'],
  captions: ['text/vtt'],
  pdf: ['application/pdf'],
};

/** Kinds enabled in M1. Audio, video, captions are deferred to T-C2.09. */
export const MEDIA_KINDS_ENABLED: MediaKind[] = ['image', 'pdf'];
