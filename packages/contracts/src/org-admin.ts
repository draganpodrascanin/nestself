/**
 * Organization administration request and response schemas (5.3).
 *
 * Shared by the API controllers under `/orgs/:orgId/*` and the admin and
 * workspace clients.
 */
import { z } from 'zod';
import { ScopeTypeSchema, GrantConditionSchema } from './authorization.ts';

const normalisedEmail = z
  .string()
  .email()
  .transform((e) => e.toLowerCase().trim());

// --- Invitations ---
export const InvitationCreateRequestSchema = z.object({
  email: normalisedEmail,
  orgUnitId: z.string().min(1).optional(),
  templateKey: z.string().min(1),
});
export type InvitationCreateRequest = z.infer<typeof InvitationCreateRequestSchema>;

export const InvitationImportRequestSchema = z.object({
  invitations: z
    .array(
      z.object({
        email: normalisedEmail,
        orgUnitId: z.string().min(1).optional(),
        templateKey: z.string().min(1),
      }),
    )
    .min(1)
    .max(500),
});
export type InvitationImportRequest = z.infer<typeof InvitationImportRequestSchema>;

export const InvitationResponseSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  orgId: z.string().min(1),
  orgUnitId: z.string().min(1).nullable(),
  templateKey: z.string().min(1),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  invitedByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type InvitationResponse = z.infer<typeof InvitationResponseSchema>;

export const InvitationImportResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.object({ email: z.string(), reason: z.string() })),
});
export type InvitationImportResponse = z.infer<typeof InvitationImportResponseSchema>;

// --- Org units ---
export const OrgUnitCreateRequestSchema = z.object({
  parentId: z.string().min(1),
  kind: z.enum(['COMPANY', 'DEPARTMENT', 'TEAM']),
  name: z.string().min(1).max(200),
  costCenterCode: z.string().max(50).optional(),
});
export type OrgUnitCreateRequest = z.infer<typeof OrgUnitCreateRequestSchema>;

export const OrgUnitUpdateRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  costCenterCode: z.string().max(50).nullable().optional(),
});
export type OrgUnitUpdateRequest = z.infer<typeof OrgUnitUpdateRequestSchema>;

export const OrgUnitMoveRequestSchema = z.object({
  parentId: z.string().min(1),
});
export type OrgUnitMoveRequest = z.infer<typeof OrgUnitMoveRequestSchema>;

export const OrgUnitResponseSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  kind: z.enum(['COMPANY', 'DEPARTMENT', 'TEAM']),
  name: z.string(),
  costCenterCode: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});
export type OrgUnitResponse = z.infer<typeof OrgUnitResponseSchema>;

// --- Members ---
export const MemberListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  orgUnitId: z.string().min(1).optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'ENDED']).optional(),
  search: z.string().max(200).optional(),
});
export type MemberListQuery = z.infer<typeof MemberListQuerySchema>;

export const MemberUpdateRequestSchema = z.object({
  orgUnitId: z.string().min(1).optional(),
  costCenterUnitId: z.string().min(1).nullable().optional(),
  lineManagerUserId: z.string().min(1).nullable().optional(),
});
export type MemberUpdateRequest = z.infer<typeof MemberUpdateRequestSchema>;

/** Controlled vocabulary for `memberships.ended_reason`. */
export const MembershipEndedReasonSchema = z.enum([
  'LEFT',
  'CONTRACT_ENDED',
  'DEACTIVATED_BY_HR',
  'SUSPENDED_BY_PLATFORM',
  'MERGED',
]);
export type MembershipEndedReason = z.infer<typeof MembershipEndedReasonSchema>;

export const MemberEndRequestSchema = z.object({
  reason: MembershipEndedReasonSchema.default('DEACTIVATED_BY_HR'),
});
export type MemberEndRequest = z.infer<typeof MemberEndRequestSchema>;

export const MemberItemSchema = z.object({
  membershipId: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string(),
  email: z.string().email(),
  orgUnitId: z.string().min(1).nullable(),
  costCenterUnitId: z.string().min(1).nullable(),
  lineManagerUserId: z.string().min(1).nullable(),
  status: z.enum(['INVITED', 'ACTIVE', 'ENDED']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().nullable(),
});
export type MemberItem = z.infer<typeof MemberItemSchema>;

export const MemberListResponseSchema = z.object({
  items: z.array(MemberItemSchema),
  nextCursor: z.string().nullable(),
});
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

// --- Grants ---
export const GrantCreateRequestSchema = z.object({
  templateKey: z.string().min(1),
  subjectUserId: z.string().min(1),
  scopeType: ScopeTypeSchema,
  scopeOrgUnitId: z.string().min(1).optional(),
  includeDescendants: z.boolean().default(false),
  conditions: z.array(GrantConditionSchema).default([]),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
});
export type GrantCreateRequest = z.infer<typeof GrantCreateRequestSchema>;

export const GrantUpdateRequestSchema = z.object({
  conditions: z.array(GrantConditionSchema).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
});
export type GrantUpdateRequest = z.infer<typeof GrantUpdateRequestSchema>;

export const GrantDelegateRequestSchema = z.object({
  parentGrantId: z.string().min(1),
  subjectUserId: z.string().min(1),
  actions: z.array(z.string().min(1)).min(1),
  scopeType: ScopeTypeSchema.optional(),
  scopeOrgUnitId: z.string().min(1).optional(),
  includeDescendants: z.boolean().optional(),
  conditions: z.array(GrantConditionSchema).default([]),
});
export type GrantDelegateRequest = z.infer<typeof GrantDelegateRequestSchema>;

export const GrantPreviewQuerySchema = z.object({
  userId: z.string().min(1),
});
export type GrantPreviewQuery = z.infer<typeof GrantPreviewQuerySchema>;

export const GrantResponseSchema = z.object({
  id: z.string().min(1),
  subjectUserId: z.string().min(1),
  templateKey: z.string().min(1).nullable(),
  actions: z.array(z.string()),
  scopeType: ScopeTypeSchema,
  scopeOrgId: z.string().min(1).nullable(),
  scopeOrgUnitId: z.string().min(1).nullable(),
  includeDescendants: z.boolean(),
  conditions: z.array(GrantConditionSchema),
  validFrom: z.string().datetime().nullable(),
  validUntil: z.string().datetime().nullable(),
  parentGrantId: z.string().min(1).nullable(),
  grantedByUserId: z.string().min(1),
  grantedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export type GrantResponse = z.infer<typeof GrantResponseSchema>;

export const GrantRevokeRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type GrantRevokeRequest = z.infer<typeof GrantRevokeRequestSchema>;

export const GrantListResponseSchema = z.object({
  items: z.array(GrantResponseSchema),
});
export type GrantListResponse = z.infer<typeof GrantListResponseSchema>;

export const GrantPreviewResponseSchema = z.object({
  userId: z.string().min(1),
  orgId: z.string().min(1),
  actions: z.array(z.string()),
  grantIds: z.array(z.string()),
  assignmentIds: z.array(z.string()),
});
export type GrantPreviewResponse = z.infer<typeof GrantPreviewResponseSchema>;

// --- Approval authorities ---
export const ApprovalAuthorityCreateRequestSchema = z.object({
  userId: z.string().min(1),
  orgUnitId: z.string().min(1).optional(),
  includeDescendants: z.boolean().default(false),
  categories: z.array(z.string().min(1)).default([]),
  maxAmountMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  alternateUserId: z.string().min(1).optional(),
  isConfidentialApprover: z.boolean().default(false),
});
export type ApprovalAuthorityCreateRequest = z.infer<typeof ApprovalAuthorityCreateRequestSchema>;

export const ApprovalAuthorityUpdateRequestSchema = z.object({
  categories: z.array(z.string().min(1)).optional(),
  maxAmountMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  alternateUserId: z.string().min(1).nullable().optional(),
  isConfidentialApprover: z.boolean().optional(),
});
export type ApprovalAuthorityUpdateRequest = z.infer<typeof ApprovalAuthorityUpdateRequestSchema>;

export const ApprovalAuthorityResponseSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  orgId: z.string().min(1),
  orgUnitId: z.string().min(1).nullable(),
  includeDescendants: z.boolean(),
  categories: z.array(z.string()),
  maxAmountMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  validFrom: z.string().datetime().nullable(),
  validUntil: z.string().datetime().nullable(),
  delegatedFromId: z.string().min(1).nullable(),
  alternateUserId: z.string().min(1).nullable(),
  isConfidentialApprover: z.boolean(),
});
export type ApprovalAuthorityResponse = z.infer<typeof ApprovalAuthorityResponseSchema>;

export const ApprovalAuthorityListResponseSchema = z.object({
  items: z.array(ApprovalAuthorityResponseSchema),
});
export type ApprovalAuthorityListResponse = z.infer<typeof ApprovalAuthorityListResponseSchema>;

// --- Operations (5.4) ---
export const UserSuspendRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type UserSuspendRequest = z.infer<typeof UserSuspendRequestSchema>;

export const UserSuspendResponseSchema = z.object({
  userId: z.string().min(1),
  suspendedAt: z.string().datetime(),
});
export type UserSuspendResponse = z.infer<typeof UserSuspendResponseSchema>;

export const UserReinstateResponseSchema = z.object({
  userId: z.string().min(1),
  reinstatedAt: z.string().datetime(),
});
export type UserReinstateResponse = z.infer<typeof UserReinstateResponseSchema>;

export const MemberEndResponseSchema = z.object({
  membershipId: z.string().min(1),
  status: z.literal('ENDED'),
  endDate: z.string().datetime(),
  endedReason: MembershipEndedReasonSchema,
  revokedGrantIds: z.array(z.string()),
});
export type MemberEndResponse = z.infer<typeof MemberEndResponseSchema>;
