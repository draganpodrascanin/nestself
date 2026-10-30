/**
 * CMS content contract schemas (7.13, T-C1.10).
 *
 * Request and response schemas for content resource, variant, revision
 * and publication endpoints.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enum schemas (mirror db enums)
// ---------------------------------------------------------------------------

export const ContentTypeSchema = z.enum([
  'article', 'video', 'audio', 'practical', 'qa', 'collection',
]);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const ContentResourceStateSchema = z.enum(['active', 'archived']);
export type ContentResourceState = z.infer<typeof ContentResourceStateSchema>;

export const ContentRevisionStateSchema = z.enum([
  'draft', 'in_review', 'changes_requested', 'approved', 'superseded',
]);
export type ContentRevisionState = z.infer<typeof ContentRevisionStateSchema>;

export const ContentPublicationStateSchema = z.enum([
  'scheduled', 'live', 'expired', 'withdrawn',
]);
export type ContentPublicationState = z.infer<typeof ContentPublicationStateSchema>;

export const ContentReviewPolicySchema = z.enum(['professional', 'editorial']);
export type ContentReviewPolicy = z.infer<typeof ContentReviewPolicySchema>;

export const ReviewDisciplineSchema = z.enum([
  'psychological', 'legal', 'financial', 'health', 'nutrition', 'general',
]);

export const AuthoredLocaleSchema = z.enum(['sr-Latn', 'hu', 'en']);
export type AuthoredLocale = z.infer<typeof AuthoredLocaleSchema>;

export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const ContentAudienceKindSchema = z.enum([
  'all_eligible', 'organization', 'org_unit',
]);
export type ContentAudienceKind = z.infer<typeof ContentAudienceKindSchema>;

/** The three authored locales (C-28). */
export const AUTHORED_LOCALES = ['sr-Latn', 'hu', 'en'] as const;

// ---------------------------------------------------------------------------
// Audience entry (shared by revision proposed_audience and publication)
// ---------------------------------------------------------------------------

export const AudienceEntrySchema = z.object({
  kind: ContentAudienceKindSchema,
  orgId: z.string().min(1).optional(),
  orgUnitId: z.string().min(1).optional(),
  includeDescendants: z.boolean().default(true),
}).superRefine((data, ctx) => {
  // WRK-R-38: strict per-kind validation
  if (data.kind === 'all_eligible') {
    if (data.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'orgId must not be set for all_eligible audience',
        path: ['orgId'],
      });
    }
    if (data.orgUnitId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'orgUnitId must not be set for all_eligible audience',
        path: ['orgUnitId'],
      });
    }
  }
  if (data.kind === 'organization') {
    if (!data.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'orgId is required for organization audience',
        path: ['orgId'],
      });
    }
    if (data.orgUnitId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'orgUnitId must not be set for organization audience',
        path: ['orgUnitId'],
      });
    }
  }
  if (data.kind === 'org_unit') {
    if (!data.orgId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'orgId is required for org_unit audience',
        path: ['orgId'],
      });
    }
    if (!data.orgUnitId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'orgUnitId is required for org_unit audience',
        path: ['orgUnitId'],
      });
    }
  }
});
export type AudienceEntry = z.infer<typeof AudienceEntrySchema>;

// ---------------------------------------------------------------------------
// Request schemas (7.13)
// ---------------------------------------------------------------------------

export const ResourceCreateRequestSchema = z.object({
  type: ContentTypeSchema,
  primaryCategoryId: z.string().min(1),
  reviewPolicy: ContentReviewPolicySchema,
  reviewDiscipline: ReviewDisciplineSchema,
  locale: AuthoredLocaleSchema,
  title: z.string().min(1).max(200),
});
export type ResourceCreateRequest = z.infer<typeof ResourceCreateRequestSchema>;

export const RevisionUpdateRequestSchema = z.object({
  body: z.record(z.string(), z.unknown()).optional(),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(500).optional(),
  outcome: z.string().max(300).nullable().optional(),
  durationSeconds: z.number().int().nonnegative().nullable().optional(),
  difficulty: DifficultySchema.nullable().optional(),
  sources: z.array(z.object({
    label: z.string().min(1),
    url: z.string().url().optional(),
  })).optional(),
  proposedAudience: z.array(AudienceEntrySchema).optional(),
  cta: z.object({
    kind: z.string().min(1),
    targetId: z.string().optional(),
  }).nullable().optional(),
  relatedResourceIds: z.array(z.string().min(1)).max(3).optional(),
  quicklyOutdated: z.boolean().optional(),
});
export type RevisionUpdateRequest = z.infer<typeof RevisionUpdateRequestSchema>;

export const VariantCreateRequestSchema = z.object({
  locale: AuthoredLocaleSchema,
  fromLocale: AuthoredLocaleSchema.optional(),
});
export type VariantCreateRequest = z.infer<typeof VariantCreateRequestSchema>;

export const ReviewDecisionRequestSchema = z.object({
  comment: z.string().max(2000).optional(),
});
export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequestSchema>;

/** Body of `POST revisions/:revisionId/return`: the comment is required on return (WRK-R-06). */
export const ReturnDecisionRequestSchema = z.object({
  comment: z.string().trim().min(1).max(2000),
});
export type ReturnDecisionRequest = z.infer<typeof ReturnDecisionRequestSchema>;

export const PublicationCreateRequestSchema = z.object({
  resourceId: z.string().min(1),
  audience: z.array(AudienceEntrySchema).min(1),
  locales: z.array(AuthoredLocaleSchema).min(1).optional(),
});
export type PublicationCreateRequest = z.infer<typeof PublicationCreateRequestSchema>;

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

export const ResourceListQuerySchema = z.object({
  state: ContentResourceStateSchema.optional(),
  categoryId: z.string().min(1).optional(),
  locale: AuthoredLocaleSchema.optional(),
  q: z.string().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ResourceListQuery = z.infer<typeof ResourceListQuerySchema>;

// ---------------------------------------------------------------------------
// Error codes (Appendix B, 7.11)
// ---------------------------------------------------------------------------

export const CMS_ERROR_CODES = [
  'content_edit_conflict',
  'content_revision_locked',
  'content_not_submittable',
  'content_self_review',
  'content_review_discipline',
  'content_approval_stale',
  'content_audience_exceeds_approval',
  'content_locale_incomplete',
  'content_publication_exists',
  'content_missing_required',
] as const;

export type CmsErrorCode = (typeof CMS_ERROR_CODES)[number];
