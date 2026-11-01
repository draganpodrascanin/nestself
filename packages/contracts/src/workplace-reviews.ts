/**
 * Workplace review contracts (spec Epics G and H, sections 8 to 10; ADR 0002,
 * D-EL-03, D-EL-04, D-EL-11, D-EL-12): the service catalogue, the employer's
 * request, the coordinator's scope, the engagement with its meeting, the
 * sharing grants and pack, the reviewer's report versions, the agreed actions
 * and the follow-up.
 *
 * Every response is a `strictObject` built by an allowlist mapper. People are
 * named by first name and function only; a reviewer never appears with an
 * account id on the employer side, and the reviewer's internal notes have no
 * employer-facing schema at all.
 */
import { z } from 'zod';
import { FollowUpTimeWindowSchema, TimeZoneSchema } from './appointments.ts';
import { HeatmapRowSchema, LocalizedTextSchema } from './listening.ts';
import { LISTENING_DIMENSION_KEYS } from './listening-scoring.ts';

const idField = z.string().min(1);
const isoDateTime = z.string().datetime();

export const REVIEW_REQUEST_STATUSES = ['submitted', 'needs_information', 'in_review', 'scoped', 'converted', 'declined', 'canceled'] as const;
export const ReviewRequestStatusSchema = z.enum(REVIEW_REQUEST_STATUSES);
export type ReviewRequestStatus = z.infer<typeof ReviewRequestStatusSchema>;
/** A request in one of these statuses occupies its scope: a second request for the cohort is answered with it. */
export const ACTIVE_REVIEW_REQUEST_STATUSES: readonly ReviewRequestStatus[] = ['submitted', 'needs_information', 'in_review', 'scoped'];

export const REVIEW_SCOPE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded'] as const;
export const ReviewScopeStatusSchema = z.enum(REVIEW_SCOPE_STATUSES);
export type ReviewScopeStatus = z.infer<typeof ReviewScopeStatusSchema>;

export const REVIEW_ENGAGEMENT_STATUSES = ['accepted', 'scheduled', 'in_progress', 'report_shared', 'follow_up', 'completed', 'canceled'] as const;
export const ReviewEngagementStatusSchema = z.enum(REVIEW_ENGAGEMENT_STATUSES);
export type ReviewEngagementStatus = z.infer<typeof ReviewEngagementStatusSchema>;
export const ACTIVE_REVIEW_ENGAGEMENT_STATUSES: readonly ReviewEngagementStatus[] = ['accepted', 'scheduled', 'in_progress', 'report_shared', 'follow_up'];

export const REVIEW_REPORT_STATUSES = ['draft', 'in_review', 'shared', 'superseded'] as const;
export const ReviewReportStatusSchema = z.enum(REVIEW_REPORT_STATUSES);
export type ReviewReportStatus = z.infer<typeof ReviewReportStatusSchema>;

export const IMPROVEMENT_ACTION_STATUSES = ['proposed', 'agreed', 'in_progress', 'completed', 'not_proceeding'] as const;
export const ImprovementActionStatusSchema = z.enum(IMPROVEMENT_ACTION_STATUSES);
export type ImprovementActionStatus = z.infer<typeof ImprovementActionStatusSchema>;

/** Allowed action transitions (spec REV-08): a proposal becomes an action only through an explicit agreement. */
export const IMPROVEMENT_ACTION_TRANSITIONS: Readonly<Record<ImprovementActionStatus, readonly ImprovementActionStatus[]>> = {
  proposed: ['agreed', 'not_proceeding'],
  agreed: ['in_progress', 'completed', 'not_proceeding'],
  in_progress: ['completed', 'not_proceeding'],
  completed: [],
  not_proceeding: [],
};

export function canTransitionAction(from: ImprovementActionStatus, to: ImprovementActionStatus): boolean {
  return IMPROVEMENT_ACTION_TRANSITIONS[from].includes(to);
}

/** The sections of the human report (spec REV-07), in reading order. */
export const REPORT_SECTION_KEYS = ['context', 'evidence', 'findings', 'uncertainties', 'proposals'] as const;
export const ReportSectionKeySchema = z.enum(REPORT_SECTION_KEYS);
export type ReportSectionKey = z.infer<typeof ReportSectionKeySchema>;

export const REVIEW_SERVICE_KEYS = ['workplace_review', 'introductory_call'] as const;
export const WORKPLACE_REVIEW_SERVICE_CATEGORY = 'workplace_review';
/** The coordinator's response target for a new request, in working days (spec REV-03). */
export const REVIEW_TRIAGE_TARGET_WORKING_DAYS = 2;
export const REVIEW_MAX_WINDOWS = 3;
export const REVIEW_CONTEXT_MAX = 2000;

export const REVIEW_ERROR_CODES = [
  'workplace_reviews_disabled',
  'active_request_exists',
  'quote_expired',
  'scope_not_sent',
  'not_scoped',
  'reviewer_not_qualified',
  'no_windows',
  'slot_unavailable',
  'sharing_revoked',
  'invalid_state',
  'report_not_shared',
  'snapshot_not_found',
] as const;
export type ReviewErrorCode = (typeof REVIEW_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Services (REV-02, REV-05)
// ---------------------------------------------------------------------------

export const ReviewServiceViewSchema = z.strictObject({
  id: idField,
  key: z.string(),
  name: LocalizedTextSchema,
  description: LocalizedTextSchema,
  durationMinutes: z.number().int().positive(),
  priceMinor: z.number().int().min(0).nullable(),
  currency: z.string().length(3),
  introductory: z.boolean(),
  termsVersion: z.string(),
  termsText: LocalizedTextSchema,
  /** `quote` when no price is configured, `free` at 0, `fixed` otherwise. */
  pricing: z.enum(['quote', 'fixed', 'free']),
});
export type ReviewServiceView = z.infer<typeof ReviewServiceViewSchema>;

export const ReviewServicesResponseSchema = z.strictObject({
  workplaceReviewsEnabled: z.boolean(),
  items: z.array(ReviewServiceViewSchema),
});
export type ReviewServicesResponse = z.infer<typeof ReviewServicesResponseSchema>;

// ---------------------------------------------------------------------------
// Requests (REV-02, REV-03)
// ---------------------------------------------------------------------------

export const ReviewRequestCreateRequestSchema = z.strictObject({
  snapshotIds: z.array(idField).min(1).max(6),
  scopeCohortKey: z.string().min(1).max(100).default('company'),
  dimensionKeys: z.array(z.enum(LISTENING_DIMENSION_KEYS)).min(1).max(LISTENING_DIMENSION_KEYS.length),
  serviceId: idField.optional(),
  context: z.string().max(REVIEW_CONTEXT_MAX).optional(),
  shareAggregates: z.boolean(),
  termsVersion: z.string().min(1).max(40),
  noticeVersion: z.string().min(1).max(40),
});
export type ReviewRequestCreateRequest = z.infer<typeof ReviewRequestCreateRequestSchema>;

export const ReviewScopeViewSchema = z.strictObject({
  id: idField,
  version: z.number().int().positive(),
  status: ReviewScopeStatusSchema,
  serviceId: idField,
  title: z.string(),
  deliverables: z.string(),
  participants: z.string(),
  priceMinor: z.number().int().min(0).nullable(),
  currency: z.string().length(3),
  taxNote: z.string().nullable(),
  termsVersion: z.string(),
  validUntil: isoDateTime,
  cancellationPolicy: z.string(),
  sentAt: isoDateTime.nullable(),
  acceptedAt: isoDateTime.nullable(),
});
export type ReviewScopeView = z.infer<typeof ReviewScopeViewSchema>;

export const ReviewRequestResponseSchema = z.strictObject({
  id: idField,
  status: ReviewRequestStatusSchema,
  scopeCohortKey: z.string(),
  dimensionKeys: z.array(z.enum(LISTENING_DIMENSION_KEYS)),
  snapshotIds: z.array(idField),
  serviceId: idField.nullable(),
  shareAggregates: z.boolean(),
  context: z.string().nullable(),
  termsVersion: z.string(),
  noticeVersion: z.string(),
  createdAt: isoDateTime,
  /** The coordinator, by first name only. */
  coordinatorFirstName: z.string().nullable(),
  declineReason: z.string().nullable(),
  informationRequest: z.string().nullable(),
  informationAnswer: z.string().nullable(),
  scopes: z.array(ReviewScopeViewSchema),
  engagementId: idField.nullable(),
});
export type ReviewRequestResponse = z.infer<typeof ReviewRequestResponseSchema>;

export const ReviewRequestListResponseSchema = z.strictObject({ items: z.array(ReviewRequestResponseSchema) });
export type ReviewRequestListResponse = z.infer<typeof ReviewRequestListResponseSchema>;

export const ReviewInformationRequestSchema = z.strictObject({ answer: z.string().min(1).max(REVIEW_CONTEXT_MAX) });
export type ReviewInformationRequest = z.infer<typeof ReviewInformationRequestSchema>;

export const ReviewCancelRequestSchema = z.strictObject({ reason: z.string().min(1).max(500).optional() });
export type ReviewCancelRequest = z.infer<typeof ReviewCancelRequestSchema>;

// ---------------------------------------------------------------------------
// Coordinator (REV-03, REV-05)
// ---------------------------------------------------------------------------

/** The queue row (spec REV-03): organization, scope, safe metadata, status, owner and response target. */
export const ReviewQueueItemSchema = z.strictObject({
  id: idField,
  orgId: idField,
  organizationName: z.string(),
  status: ReviewRequestStatusSchema,
  scopeCohortKey: z.string(),
  dimensionKeys: z.array(z.enum(LISTENING_DIMENSION_KEYS)),
  snapshotCount: z.number().int().min(0),
  shareAggregates: z.boolean(),
  requesterFirstName: z.string().nullable(),
  coordinatorFirstName: z.string().nullable(),
  coordinatorUserId: idField.nullable(),
  createdAt: isoDateTime,
  /** `createdAt` plus the triage target, skipping weekends. */
  dueAt: isoDateTime,
  overdue: z.boolean(),
  engagementId: idField.nullable(),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;

export const ReviewQueueResponseSchema = z.strictObject({ items: z.array(ReviewQueueItemSchema) });
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponseSchema>;

/** The coordinator's view of a request: the employer view plus the organization, the requester and the engagement. */
export const ReviewRequestOpsResponseSchema = ReviewRequestResponseSchema.extend({
  orgId: idField,
  organizationName: z.string(),
  requesterFirstName: z.string().nullable(),
  coordinatorUserId: idField.nullable(),
});
export type ReviewRequestOpsResponse = z.infer<typeof ReviewRequestOpsResponseSchema>;

export const ReviewTriageRequestSchema = z
  .strictObject({
    status: z.enum(['in_review', 'needs_information', 'declined']),
    informationRequest: z.string().min(1).max(REVIEW_CONTEXT_MAX).optional(),
    declineReason: z.string().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'needs_information' && !v.informationRequest) {
      ctx.addIssue({ code: 'custom', path: ['informationRequest'], message: 'Say what information is needed' });
    }
    if (v.status === 'declined' && !v.declineReason) {
      ctx.addIssue({ code: 'custom', path: ['declineReason'], message: 'An employer-facing reason is required to decline' });
    }
  });
export type ReviewTriageRequest = z.infer<typeof ReviewTriageRequestSchema>;

export const ReviewScopeCreateRequestSchema = z.strictObject({
  serviceId: idField,
  title: z.string().min(1).max(200),
  deliverables: z.string().min(1).max(4000),
  participants: z.string().min(1).max(1000),
  priceMinor: z.number().int().min(0).nullable(),
  currency: z.string().length(3).default('EUR'),
  taxNote: z.string().max(500).nullable().optional(),
  termsVersion: z.string().min(1).max(40),
  validUntil: isoDateTime,
  cancellationPolicy: z.string().min(1).max(2000),
});
export type ReviewScopeCreateRequest = z.infer<typeof ReviewScopeCreateRequestSchema>;

export const ReviewAssignRequestSchema = z.strictObject({ reviewerUserId: idField });
export type ReviewAssignRequest = z.infer<typeof ReviewAssignRequestSchema>;

export const ReviewWindowsRequestSchema = z.strictObject({
  windows: z.array(FollowUpTimeWindowSchema).min(1).max(REVIEW_MAX_WINDOWS),
  timeZone: TimeZoneSchema,
});
export type ReviewWindowsRequest = z.infer<typeof ReviewWindowsRequestSchema>;

export const ReviewBookRequestSchema = z.strictObject({ windowIndex: z.number().int().min(0).max(REVIEW_MAX_WINDOWS - 1) });
export type ReviewBookRequest = z.infer<typeof ReviewBookRequestSchema>;

export const ReviewerCandidateSchema = z.strictObject({ userId: idField, displayName: z.string() });
export const ReviewerCandidatesResponseSchema = z.strictObject({ items: z.array(ReviewerCandidateSchema) });
export type ReviewerCandidatesResponse = z.infer<typeof ReviewerCandidatesResponseSchema>;

// ---------------------------------------------------------------------------
// Engagement (REV-04..10)
// ---------------------------------------------------------------------------

export const ReviewAppointmentViewSchema = z.strictObject({
  id: idField,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  timeZone: z.string(),
  status: z.string(),
});
export type ReviewAppointmentView = z.infer<typeof ReviewAppointmentViewSchema>;

export const ReviewSharingGrantViewSchema = z.strictObject({
  id: idField,
  snapshotIds: z.array(idField),
  cohortKeys: z.array(z.string()),
  validUntil: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  active: z.boolean(),
});
export type ReviewSharingGrantView = z.infer<typeof ReviewSharingGrantViewSchema>;

export const ReviewSharingGrantRequestSchema = z.strictObject({
  snapshotIds: z.array(idField).min(1).max(6),
  cohortKeys: z.array(z.string().min(1)).min(1).max(50),
  validUntil: isoDateTime.optional(),
});
export type ReviewSharingGrantRequest = z.infer<typeof ReviewSharingGrantRequestSchema>;

/** Rich-text sections as `ContentDocument`s; the API validates every node with `validateContentDocument`. */
export const ReviewReportSectionsSchema = z.object({
  context: z.unknown(),
  evidence: z.unknown(),
  findings: z.unknown(),
  uncertainties: z.unknown(),
  proposals: z.unknown(),
});
export type ReviewReportSections = z.infer<typeof ReviewReportSectionsSchema>;

export const ReviewReportViewSchema = z.strictObject({
  id: idField,
  version: z.number().int().positive(),
  status: ReviewReportStatusSchema,
  sections: ReviewReportSectionsSchema,
  evidenceSnapshotIds: z.array(idField),
  authorFirstName: z.string().nullable(),
  sharedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
});
export type ReviewReportView = z.infer<typeof ReviewReportViewSchema>;

export const ReviewReportDraftRequestSchema = z.strictObject({
  sections: ReviewReportSectionsSchema,
  evidenceSnapshotIds: z.array(idField).max(6).default([]),
});
export type ReviewReportDraftRequest = z.infer<typeof ReviewReportDraftRequestSchema>;

export const ImprovementActionViewSchema = z.strictObject({
  id: idField,
  title: z.string(),
  description: z.string(),
  status: ImprovementActionStatusSchema,
  ownerUserId: idField.nullable(),
  ownerFirstName: z.string().nullable(),
  dueDate: isoDateTime.nullable(),
  intendedCheck: z.string(),
  dimensionKey: z.enum(LISTENING_DIMENSION_KEYS).nullable(),
  reportVersionId: idField.nullable(),
  /** `reviewer` for a proposal from the report, `employer` for a human entry on the employer side. */
  proposedBy: z.enum(['reviewer', 'employer']),
  agreedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  notProceedingReason: z.string().nullable(),
  createdAt: isoDateTime,
});
export type ImprovementActionView = z.infer<typeof ImprovementActionViewSchema>;

export const ImprovementActionCreateRequestSchema = z.strictObject({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  ownerUserId: idField.optional(),
  dueDate: isoDateTime.optional(),
  intendedCheck: z.string().min(1).max(1000),
  dimensionKey: z.enum(LISTENING_DIMENSION_KEYS).optional(),
  reportVersionId: idField.optional(),
});
export type ImprovementActionCreateRequest = z.infer<typeof ImprovementActionCreateRequestSchema>;

export const ImprovementActionUpdateRequestSchema = z
  .strictObject({
    status: ImprovementActionStatusSchema.optional(),
    ownerUserId: idField.nullable().optional(),
    dueDate: isoDateTime.nullable().optional(),
    notProceedingReason: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type ImprovementActionUpdateRequest = z.infer<typeof ImprovementActionUpdateRequestSchema>;

export const ReviewFollowUpRequestSchema = z.strictObject({
  targetDate: isoDateTime,
  ownerUserId: idField.optional(),
});
export type ReviewFollowUpRequest = z.infer<typeof ReviewFollowUpRequestSchema>;

export const ReviewNoteRequestSchema = z.strictObject({ body: z.string().min(1).max(5000) });
export type ReviewNoteRequest = z.infer<typeof ReviewNoteRequestSchema>;

export const ReviewNoteViewSchema = z.strictObject({ id: idField, body: z.string(), createdAt: isoDateTime });
export const ReviewNotesResponseSchema = z.strictObject({ items: z.array(ReviewNoteViewSchema) });
export type ReviewNotesResponse = z.infer<typeof ReviewNotesResponseSchema>;

export const ReviewFollowUpViewSchema = z.strictObject({
  targetDate: isoDateTime,
  ownerUserId: idField.nullable(),
  ownerFirstName: z.string().nullable(),
});

export const ReviewEngagementResponseSchema = z.strictObject({
  id: idField,
  orgId: idField,
  requestId: idField,
  status: ReviewEngagementStatusSchema,
  scope: ReviewScopeViewSchema,
  scopeCohortKey: z.string(),
  dimensionKeys: z.array(z.enum(LISTENING_DIMENSION_KEYS)),
  reviewerFirstName: z.string().nullable(),
  coordinatorFirstName: z.string().nullable(),
  appointment: ReviewAppointmentViewSchema.nullable(),
  proposedWindows: z.array(FollowUpTimeWindowSchema).nullable(),
  proposedTimeZone: z.string().nullable(),
  sharingGrants: z.array(ReviewSharingGrantViewSchema),
  /** The latest shared report, or null; the reviewer's side also sees the draft through its own route. */
  sharedReport: ReviewReportViewSchema.nullable(),
  actions: z.array(ImprovementActionViewSchema),
  followUp: ReviewFollowUpViewSchema.nullable(),
  completedAt: isoDateTime.nullable(),
  canceledAt: isoDateTime.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: isoDateTime,
});
export type ReviewEngagementResponse = z.infer<typeof ReviewEngagementResponseSchema>;

export const ReviewEngagementListResponseSchema = z.strictObject({ items: z.array(ReviewEngagementResponseSchema) });
export type ReviewEngagementListResponse = z.infer<typeof ReviewEngagementListResponseSchema>;

/** The aggregate pack (spec REV-04): the granted snapshots, as the heatmap shows them, suppression included. */
export const ReviewPackSnapshotSchema = z.strictObject({
  snapshotId: idField,
  cycleOpensAt: isoDateTime,
  cycleClosesAt: isoDateTime,
  questionnaireVersion: z.number().int().positive(),
  rows: z.array(HeatmapRowSchema),
});
export const ReviewPackResponseSchema = z.strictObject({
  engagementId: idField,
  grants: z.array(ReviewSharingGrantViewSchema),
  snapshots: z.array(ReviewPackSnapshotSchema),
});
export type ReviewPackResponse = z.infer<typeof ReviewPackResponseSchema>;

export const ImprovementActionsResponseSchema = z.strictObject({ items: z.array(ImprovementActionViewSchema) });
export type ImprovementActionsResponse = z.infer<typeof ImprovementActionsResponseSchema>;
