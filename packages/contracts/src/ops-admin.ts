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
  /** True while the account is suspended (`POST /ops/users/:userId/suspend`). */
  suspended: z.boolean(),
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

// --- SSO connections (D-12, 3.4, 5.4) ---

export const SSO_PROTOCOLS = ['SAML', 'OIDC'] as const;
export const SsoProtocolSchema = z.enum(SSO_PROTOCOLS);
export type SsoProtocol = z.infer<typeof SsoProtocolSchema>;

/** Lifecycle of `sso_connections.status` (3.4.1). */
export const SSO_CONNECTION_STATUSES = ['DRAFT', 'TESTING', 'ACTIVE', 'SUSPENDED'] as const;
export const SsoConnectionStatusSchema = z.enum(SSO_CONNECTION_STATUSES);
export type SsoConnectionStatus = z.infer<typeof SsoConnectionStatusSchema>;

/**
 * Statuses a `PATCH` may request. `TESTING` is set only by `POST :id/test`
 * and `ACTIVE` from `TESTING` only by `POST :id/activate`; the service
 * enforces the allowed transitions.
 */
export const SSO_CONNECTION_PATCH_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED'] as const;

/** Builds the Cognito provider name `org-<slug>-saml|oidc` (at most 20 characters). */
export const SSO_SLUG_PATTERN = /^[a-z0-9-]{2,12}$/;

/** One lowercase DNS label per segment, at least two segments, no scheme, path or `@`. */
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * IdP-initiated sign-in stays off until the written risk-acceptance process
 * exists (D-12, SSO-R-12): the field is accepted only as `false`.
 */
const idpInitiatedOff = (value: { idpInitiatedAllowed?: boolean }) => value.idpInitiatedAllowed !== true;
const IDP_INITIATED_REFUSED = {
  message: 'IdP-initiated sign-in is not available',
  path: ['idpInitiatedAllowed'],
};

/** `POST /ops/sso-connections`: a new connection starts in `DRAFT`. */
export const SsoConnectionCreateRequestSchema = z
  .object({
    orgId: z.string().min(1),
    /** Short organization handle used to build `cognitoProviderName`. */
    slug: z.string().regex(SSO_SLUG_PATTERN),
    protocol: SsoProtocolSchema,
    metadataUrl: z.string().url().optional(),
    metadataXml: z.string().optional(),
    oidcIssuer: z.string().url().optional(),
    oidcClientId: z.string().min(1).optional(),
    attributeMapping: z.record(z.string(), z.string()).optional(),
    idpInitiatedAllowed: z.boolean().default(false),
    jitProvisioning: z.boolean().default(false),
    defaultOrgUnitId: z.string().min(1).optional(),
  })
  .refine(idpInitiatedOff, IDP_INITIATED_REFUSED);
export type SsoConnectionCreateRequest = z.infer<typeof SsoConnectionCreateRequestSchema>;

/**
 * `PATCH /ops/sso-connections/:id`: at least one field. `null` clears a
 * metadata field or the default org unit.
 */
export const SsoConnectionUpdateRequestSchema = z
  .object({
    status: z.enum(SSO_CONNECTION_PATCH_STATUSES).optional(),
    /** Immutable once the connection has been tested (the service answers 422). */
    protocol: SsoProtocolSchema.optional(),
    metadataUrl: z.string().url().nullable().optional(),
    metadataXml: z.string().nullable().optional(),
    oidcIssuer: z.string().url().nullable().optional(),
    oidcClientId: z.string().min(1).nullable().optional(),
    attributeMapping: z.record(z.string(), z.string()).nullable().optional(),
    idpInitiatedAllowed: z.boolean().optional(),
    jitProvisioning: z.boolean().optional(),
    defaultOrgUnitId: z.string().min(1).nullable().optional(),
  })
  .refine(idpInitiatedOff, IDP_INITIATED_REFUSED)
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });
export type SsoConnectionUpdateRequest = z.infer<typeof SsoConnectionUpdateRequestSchema>;

/** `POST /ops/sso-connections/:id/domains`: the domain is trimmed and lowercased. */
export const SsoConnectionDomainRequestSchema = z.object({
  domain: z
    .string()
    .transform((d) => d.trim().toLowerCase())
    .pipe(z.string().regex(DOMAIN_PATTERN)),
});
export type SsoConnectionDomainRequest = z.infer<typeof SsoConnectionDomainRequestSchema>;

/**
 * One domain of a connection with the DNS TXT record that proves ownership
 * (3.4.4): `txtRecordName` is `_nestself-verify.<domain>`, `txtRecordValue`
 * is `nestself-domain-verification=<token>`.
 */
export const SsoDomainResponseSchema = z.object({
  id: z.string().min(1),
  domain: z.string().min(1),
  verifiedAt: z.string().datetime().nullable(),
  txtRecordName: z.string().min(1),
  txtRecordValue: z.string().min(1),
});
export type SsoDomainResponse = z.infer<typeof SsoDomainResponseSchema>;

/** Service-provider values the client's IdP administrator needs; null until known for the stage. */
export const SsoSpMetadataSchema = z.object({
  entityId: z.string().min(1),
  acsUrl: z.string().url(),
});
export type SsoSpMetadata = z.infer<typeof SsoSpMetadataSchema>;

export const SsoConnectionResponseSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  protocol: SsoProtocolSchema,
  cognitoProviderName: z.string(),
  status: SsoConnectionStatusSchema,
  metadataUrl: z.string().url().nullable(),
  oidcIssuer: z.string().url().nullable(),
  oidcClientId: z.string().nullable(),
  idpInitiatedAllowed: z.boolean(),
  jitProvisioning: z.boolean(),
  defaultOrgUnitId: z.string().nullable(),
  certificateExpiresAt: z.string().datetime().nullable(),
  lastTestedAt: z.string().datetime().nullable(),
  domains: z.array(SsoDomainResponseSchema),
  spMetadata: SsoSpMetadataSchema.nullable(),
});
export type SsoConnectionResponse = z.infer<typeof SsoConnectionResponseSchema>;

export const SsoConnectionListResponseSchema = z.object({
  items: z.array(SsoConnectionResponseSchema),
});
export type SsoConnectionListResponse = z.infer<typeof SsoConnectionListResponseSchema>;

/** `POST /ops/sso-connections/:id/test`: an absolute URL that starts a test sign-in. */
export const SsoTestResponseSchema = z.object({
  startUrl: z.string().url(),
});
export type SsoTestResponse = z.infer<typeof SsoTestResponseSchema>;
