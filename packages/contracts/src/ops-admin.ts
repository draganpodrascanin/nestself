/**
 * Operations administration request and response schemas (5.4).
 *
 * Shared by the API controllers under `/ops/*` and the admin client.
 */
import { z } from 'zod';
import { GrantCreateRequestSchema } from './org-admin.ts';

/**
 * `POST /ops/grants`: a platform-level grant (`scope_org_id` null) from an
 * operations template. The server accepts only templates whose workspace is
 * `operations` and whose own `scopeType` matches the request.
 */
export const PlatformGrantCreateRequestSchema = GrantCreateRequestSchema.omit({
  scopeOrgUnitId: true,
  includeDescendants: true,
});
export type PlatformGrantCreateRequest = z.infer<typeof PlatformGrantCreateRequestSchema>;

/** One evaluated context of `GET /ops/users/:userId/access`; `orgId` null is the platform context. */
export const UserAccessContextSchema = z.object({
  orgId: z.string().min(1).nullable(),
  actions: z.array(z.string().min(1)),
  grantIds: z.array(z.string().min(1)),
  assignmentIds: z.array(z.string().min(1)),
});
export type UserAccessContext = z.infer<typeof UserAccessContextSchema>;

export const UserAccessResponseSchema = z.object({
  userId: z.string().min(1),
  contexts: z.array(UserAccessContextSchema),
});
export type UserAccessResponse = z.infer<typeof UserAccessResponseSchema>;

// --- Emergency access (4.7, API-R-26, CONF-R-08..10) ---

export const EmergencyScopeKindSchema = z.enum(['CASE', 'USER_RECORDS']);
export type EmergencyScopeKind = z.infer<typeof EmergencyScopeKindSchema>;

/** Hard ceiling on an emergency access window: four hours from approval (API-R-26). */
export const EMERGENCY_ACCESS_MAX_MINUTES = 240;
export const EMERGENCY_ACCESS_MIN_MINUTES = 15;

/** `POST /ops/emergency-access`: a written purpose, one narrow scope and the requested window. */
export const EmergencyAccessCreateRequestSchema = z.object({
  purpose: z.string().min(10).max(1000),
  scopeKind: EmergencyScopeKindSchema,
  scopeId: z.string().min(1),
  durationMinutes: z
    .number()
    .int()
    .min(EMERGENCY_ACCESS_MIN_MINUTES)
    .max(EMERGENCY_ACCESS_MAX_MINUTES)
    .default(EMERGENCY_ACCESS_MAX_MINUTES),
});
export type EmergencyAccessCreateRequest = z.infer<typeof EmergencyAccessCreateRequestSchema>;

/**
 * One emergency access record. A pending request has `approvedByUserId` and
 * `approvedAt` null and a provisional `grantedAt`/`expiresAt`; approval
 * restarts the window from the approval time.
 */
export const EmergencyAccessResponseSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  approvedByUserId: z.string().min(1).nullable(),
  purpose: z.string(),
  scopeKind: EmergencyScopeKindSchema,
  scopeId: z.string(),
  durationMinutes: z.number().int(),
  grantedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export type EmergencyAccessResponse = z.infer<typeof EmergencyAccessResponseSchema>;

export const EmergencyAccessListResponseSchema = z.object({
  items: z.array(EmergencyAccessResponseSchema),
});
export type EmergencyAccessListResponse = z.infer<typeof EmergencyAccessListResponseSchema>;

/** Restricted record types readable under emergency access, one record per request (CONF-R-09). */
export const EMERGENCY_RECORD_TYPES = ['conversation', 'intake'] as const;
export const EmergencyRecordTypeSchema = z.enum(EMERGENCY_RECORD_TYPES);
export type EmergencyRecordType = z.infer<typeof EmergencyRecordTypeSchema>;

/** `GET /ops/emergency-access/:id/records/:recordType/:recordId`; `content` matches the professional route's body. */
export const EmergencyRecordResponseSchema = z.object({
  emergencyAccessId: z.string().min(1),
  recordType: EmergencyRecordTypeSchema,
  recordId: z.string().min(1),
  content: z.unknown(),
});
export type EmergencyRecordResponse = z.infer<typeof EmergencyRecordResponseSchema>;

// --- Organizations (client list for the operations workspace) ---

/** Lifecycle of an employer client (`organizations.status`). */
export const ORGANIZATION_STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'ENDED'] as const;
export const OrganizationStatusSchema = z.enum(ORGANIZATION_STATUSES);
export type OrganizationStatus = z.infer<typeof OrganizationStatusSchema>;

/** `GET /ops/organizations`: ordered by name, then id; `search` matches a name or slug prefix. */
export const OrganizationListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(200).optional(),
});
export type OrganizationListQuery = z.infer<typeof OrganizationListQuerySchema>;

export const OrganizationResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  status: OrganizationStatusSchema,
  createdAt: z.string().datetime(),
});
export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;

export const OrganizationListResponseSchema = z.object({
  items: z.array(OrganizationResponseSchema),
  /** Id of the last item; pass it back as `cursor` for the next page. */
  nextCursor: z.string().nullable(),
});
export type OrganizationListResponse = z.infer<typeof OrganizationListResponseSchema>;
