/**
 * Typed CMS API client (T-C1.12, 7.11).
 *
 * Factory that wraps the operations CMS endpoints under `/api/ops/cms/`.
 *
 * The ETag contract: the server returns `lockVersion` in the revision body
 * AND sets an `ETag: "<lockVersion>"` response header. Since `ApiClient.request`
 * only returns the parsed body, callers use `lockVersion` from the body to
 * construct the next `If-Match` header.
 */
import { z } from 'zod';
import type {
  ResourceCreateRequest,
  RevisionUpdateRequest,
  PublicationCreateRequest,
  MediaUploadMetadata,
  AuthoredLocale,
} from '@nestself/contracts';
import {
  ContentTypeSchema,
  ContentResourceStateSchema,
  ContentRevisionStateSchema,
  ContentPublicationStateSchema,
  ContentReviewPolicySchema,
  ReviewDisciplineSchema,
  ContentAudienceKindSchema,
  MediaAssetStateSchema,
  MediaKindSchema,
  MediaScanStatusSchema,
  MediaLicenseKindSchema,
  MediaRenditionKindSchema,
} from '@nestself/contracts';
import type { ApiClient } from './client';

// ---------------------------------------------------------------------------
// Response schemas (client-side validation of API responses)
// ---------------------------------------------------------------------------

const AudienceResponseSchema = z.object({
  id: z.string(),
  publicationId: z.string(),
  kind: ContentAudienceKindSchema,
  orgId: z.string().nullable(),
  orgUnitId: z.string().nullable(),
  includeDescendants: z.boolean(),
});

export const RevisionResponseSchema = z.object({
  id: z.string(),
  contentVariantId: z.string(),
  revisionNumber: z.number(),
  state: ContentRevisionStateSchema,
  body: z.record(z.string(), z.unknown()),
  title: z.string(),
  summary: z.string(),
  outcome: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  durationBand: z.string().nullable(),
  difficulty: z.string().nullable(),
  sources: z.unknown().nullable(),
  proposedAudience: z.unknown().nullable(),
  cta: z.unknown().nullable(),
  relatedResourceIds: z.array(z.string()).nullable(),
  authorUserId: z.string(),
  lastEditorUserId: z.string(),
  lockVersion: z.number(),
  approvalHash: z.string().nullable(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedByUserId: z.string().nullable(),
  reviewDueAt: z.string().nullable(),
  quicklyOutdated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RevisionResponse = z.infer<typeof RevisionResponseSchema>;

const PublicationResponseSchema = z.object({
  id: z.string(),
  contentVariantId: z.string(),
  contentRevisionId: z.string(),
  approvalHash: z.string().nullable(),
  state: ContentPublicationStateSchema,
  requiredCapability: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  scheduleTimeZone: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  withdrawnByUserId: z.string().nullable(),
  withdrawalReason: z.string().nullable(),
  publishedByUserId: z.string().nullable(),
  editorialPriority: z.number().nullable(),
  createdAt: z.string(),
  audiences: z.array(AudienceResponseSchema).optional(),
});
export type PublicationResponse = z.infer<typeof PublicationResponseSchema>;

const VariantResponseSchema = z.object({
  id: z.string(),
  contentResourceId: z.string(),
  locale: z.string(),
  slug: z.string(),
  localApplicability: z.string().nullable(),
  createdAt: z.string(),
  revisions: z.array(RevisionResponseSchema).optional(),
  publications: z.array(PublicationResponseSchema).optional(),
});
export type VariantResponse = z.infer<typeof VariantResponseSchema>;

const ResourceSummarySchema = z.object({
  id: z.string(),
  type: ContentTypeSchema,
  state: ContentResourceStateSchema,
  primaryCategoryId: z.string(),
  ownerUserId: z.string(),
  reviewPolicy: ContentReviewPolicySchema,
  reviewDiscipline: ReviewDisciplineSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ResourceSummary = z.infer<typeof ResourceSummarySchema>;

const ResourceListResponseSchema = z.object({
  items: z.array(ResourceSummarySchema),
  nextCursor: z.string().nullable(),
});

const ResourceDetailResponseSchema = ResourceSummarySchema.extend({
  backupOwnerUserId: z.string().nullable().optional(),
  schemaVersion: z.number().optional(),
  archivedAt: z.string().nullable().optional(),
  variants: z.array(VariantResponseSchema),
});
export type ResourceDetailResponse = z.infer<typeof ResourceDetailResponseSchema>;

const MediaRenditionResponseSchema = z.object({
  id: z.string(),
  kind: MediaRenditionKindSchema,
  width: z.number().nullable(),
  height: z.number().nullable(),
  byteSize: z.number(),
  mimeType: z.string(),
});

const MediaAssetDetailResponseSchema = z.object({
  id: z.string(),
  kind: MediaKindSchema,
  state: MediaAssetStateSchema,
  ownerCategoryId: z.string().nullable(),
  checksumSha256: z.string().nullable(),
  byteSize: z.number(),
  mimeType: z.string(),
  durationSeconds: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  scanStatus: MediaScanStatusSchema,
  licenseKind: MediaLicenseKindSchema.nullable(),
  licenseReference: z.string().nullable(),
  rightsExpiresAt: z.string().nullable(),
  consentReference: z.string().nullable(),
  altText: z.record(z.string(), z.string()).nullable(),
  focalPoint: z.object({ x: z.number(), y: z.number() }).nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  renditions: z.array(MediaRenditionResponseSchema).optional(),
});
export type MediaAssetDetailResponse = z.infer<typeof MediaAssetDetailResponseSchema>;

const MediaUploadResponseSchema = z.object({
  assetId: z.string(),
  state: z.string(),
});
export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;

// ---------------------------------------------------------------------------
// Content-Digest helper (RFC 9530, MED-R-33)
// ---------------------------------------------------------------------------

/**
 * Compute the RFC 9530 `Content-Digest` header value for a file.
 *
 * Uses Web Crypto SHA-256 on the client. The result is:
 * `sha-256=:<base64-encoded-hash>:`
 */
export async function computeContentDigest(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(hashBuffer);
  // Convert to base64 using a portable approach
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);
  return `sha-256=:${base64}:`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  };
}

function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCmsApi(client: ApiClient) {
  const base = '/api/ops/cms';

  return {
    // ─── Resources ─────────────────────────────────────────────────

    /** POST /api/ops/cms/resources — create resource. */
    createResource: (body: ResourceCreateRequest) =>
      client.request(`${base}/resources`, {
        ...send('POST', body),
        schema: ResourceDetailResponseSchema,
      }),

    /** GET /api/ops/cms/resources — list (category-scoped). */
    listResources: (params: {
      state?: string;
      categoryId?: string;
      locale?: string;
      cursor?: string;
      limit?: number;
    } = {}) =>
      client.request(`${base}/resources${queryString(params)}`, {
        method: 'GET',
        schema: ResourceListResponseSchema,
      }),

    /** GET /api/ops/cms/resources/:resourceId — detail. */
    getResource: (resourceId: string) =>
      client.request(`${base}/resources/${encodeURIComponent(resourceId)}`, {
        method: 'GET',
        schema: ResourceDetailResponseSchema,
      }),

    // ─── Variants ──────────────────────────────────────────────────

    /** POST /api/ops/cms/resources/:resourceId/variants — add locale variant. */
    addVariant: (resourceId: string, locale: AuthoredLocale, fromLocale?: AuthoredLocale) =>
      client.request(
        `${base}/resources/${encodeURIComponent(resourceId)}/variants`,
        {
          ...send('POST', { locale, ...(fromLocale ? { fromLocale } : {}) }),
          schema: RevisionResponseSchema,
        },
      ),

    // ─── Revisions ─────────────────────────────────────────────────

    /**
     * PUT /api/ops/cms/variants/:variantId/revisions/:revisionId — save.
     *
     * Sends the `If-Match` header with the current lockVersion.
     * Returns the updated revision including the new `lockVersion`.
     */
    saveRevision: (
      variantId: string,
      revisionId: string,
      body: RevisionUpdateRequest,
      lockVersion: number,
    ) =>
      client.request(
        `${base}/variants/${encodeURIComponent(variantId)}/revisions/${encodeURIComponent(revisionId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
          headers: {
            'Content-Type': 'application/json',
            'If-Match': `"${lockVersion}"`,
          },
          schema: RevisionResponseSchema,
        },
      ),

    /** POST /api/ops/cms/variants/:variantId/revisions — new working revision. */
    createNewRevision: (variantId: string) =>
      client.request(
        `${base}/variants/${encodeURIComponent(variantId)}/revisions`,
        {
          ...send('POST', {}),
          schema: RevisionResponseSchema,
        },
      ),

    // ─── Review ────────────────────────────────────────────────────

    /** POST /api/ops/cms/revisions/:revisionId/submit — submit for review. */
    submitRevision: (revisionId: string) =>
      client.request(
        `${base}/revisions/${encodeURIComponent(revisionId)}/submit`,
        {
          ...send('POST', {}),
          schema: RevisionResponseSchema,
        },
      ),

    /** POST /api/ops/cms/revisions/:revisionId/approve — approve. */
    approveRevision: (revisionId: string) =>
      client.request(
        `${base}/revisions/${encodeURIComponent(revisionId)}/approve`,
        {
          ...send('POST', {}),
          schema: RevisionResponseSchema,
        },
      ),

    /** POST /api/ops/cms/revisions/:revisionId/return — return for changes. */
    returnForChanges: (revisionId: string, comment: string) =>
      client.request(
        `${base}/revisions/${encodeURIComponent(revisionId)}/return`,
        {
          ...send('POST', { comment }),
          schema: RevisionResponseSchema,
        },
      ),

    // ─── Publications ──────────────────────────────────────────────

    /**
     * POST /api/ops/cms/publications — publish now.
     *
     * Returns `{ publications: [...] }`, one per published locale
     * (coordinator shape update 2026-10-25).
     */
    publishNow: (body: PublicationCreateRequest) =>
      client.request(`${base}/publications`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': generateIdempotencyKey(),
        },
        schema: z.object({ publications: z.array(PublicationResponseSchema) }),
      }),

    // ─── Media ─────────────────────────────────────────────────────

    /**
     * POST /api/ops/cms/media — upload a media file.
     *
     * Computes the RFC 9530 Content-Digest client-side and sends the
     * file as multipart/form-data with metadata fields before the file part.
     */
    uploadMedia: async (
      file: File,
      metadata: MediaUploadMetadata,
      idempotencyKey?: string,
    ): Promise<MediaUploadResponse> => {
      const digest = await computeContentDigest(file);
      const formData = new FormData();

      // Metadata fields BEFORE file part (MED-R-33)
      formData.append('kind', metadata.kind);
      formData.append('ownerCategoryId', metadata.ownerCategoryId);
      formData.append('licenseKind', metadata.licenseKind);
      if (metadata.licenseReference != null) {
        formData.append('licenseReference', metadata.licenseReference);
      }
      if (metadata.consentReference != null) {
        formData.append('consentReference', metadata.consentReference);
      }
      if (metadata.altText) {
        formData.append('altText', JSON.stringify(metadata.altText));
      }
      if (metadata.focalPoint) {
        formData.append('focalPoint', JSON.stringify(metadata.focalPoint));
      }

      // File LAST
      formData.append('file', file);

      return client.request(`${base}/media`, {
        method: 'POST',
        body: formData,
        // Do NOT set Content-Type; the browser sets the multipart boundary.
        headers: {
          'Content-Digest': digest,
          'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey(),
        },
        schema: MediaUploadResponseSchema,
      });
    },

    /** GET /api/ops/cms/media/:assetId — media detail. */
    getMediaAsset: (assetId: string) =>
      client.request(`${base}/media/${encodeURIComponent(assetId)}`, {
        method: 'GET',
        schema: MediaAssetDetailResponseSchema,
      }),
  };
}

export type CmsApi = ReturnType<typeof createCmsApi>;
