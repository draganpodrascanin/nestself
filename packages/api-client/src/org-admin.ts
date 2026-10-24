/**
 * Typed wrappers for organization administration: invitations, members, org
 * units, grants and approval authorities (auth-strategy.md section 5.3) and
 * their operations mirrors (section 5.4), plus the operations-only client
 * list, user suspension and emergency access routes.
 *
 * One factory serves both workspaces. `{ kind: 'org' }` targets
 * `/api/orgs/:orgId/...` and returns the full `OrgAdminApi`; `{ kind: 'ops' }`
 * targets `/api/ops/orgs/:orgId/...` for the routes the operations mirror
 * exposes and adds the platform-level methods (`OpsAdminApi`). Methods the
 * server has no route for are absent from the type rather than throwing.
 */
import { z } from 'zod';
import {
  ApprovalAuthorityListResponseSchema,
  ApprovalAuthorityResponseSchema,
  EmergencyAccessListResponseSchema,
  EmergencyAccessResponseSchema,
  EmergencyRecordResponseSchema,
  GrantListResponseSchema,
  GrantPreviewResponseSchema,
  GrantResponseSchema,
  InvitationCreateResponseSchema,
  InvitationImportResponseSchema,
  InvitationListResponseSchema,
  InvitationResponseSchema,
  MemberEndResponseSchema,
  MemberItemSchema,
  MemberListResponseSchema,
  OrganizationListResponseSchema,
  OrganizationResponseSchema,
  OrgUnitListResponseSchema,
  OrgUnitResponseSchema,
  OwnershipTransferResponseSchema,
  UserAccessResponseSchema,
  UserReinstateResponseSchema,
  UserSuspendResponseSchema,
} from '@nestself/contracts';
import type {
  ApprovalAuthorityCreateRequest,
  ApprovalAuthorityUpdateRequest,
  EmergencyAccessCreateRequestSchema,
  EmergencyRecordType,
  GrantCreateRequest,
  GrantDelegateRequest,
  GrantRevokeRequest,
  GrantUpdateRequest,
  InvitationCreateRequest,
  InvitationImportRequest,
  MemberEndRequestSchema,
  MemberListQuery,
  MemberUpdateRequest,
  OrgUnitCreateRequest,
  OrgUnitMoveRequest,
  OrgUnitUpdateRequest,
  OwnershipTransferRequest,
  PlatformGrantCreateRequest,
  UserSuspendRequest,
} from '@nestself/contracts';
import type { ApiClient } from './client';

export type OrgAdminBase = { kind: 'org' } | { kind: 'ops' };

/** Query of the grant list routes (`GrantListQuerySchema` in the API). */
export interface GrantListParams {
  subjectUserId?: string;
  includeRevoked?: boolean;
}

/** Query of the pending invitation lists (`InvitationListQuerySchema`). */
export interface InvitationListParams {
  cursor?: string;
  limit?: number;
}

/** Query of `GET /ops/organizations` (`OrganizationListQuerySchema`). */
export interface OrganizationListParams {
  cursor?: string;
  limit?: number;
  search?: string;
}

/** Query of `GET /ops/emergency-access`. */
export interface EmergencyAccessListParams {
  userId?: string;
}

/** Body of `POST .../members/:membershipId/end`; `reason` defaults to `DEACTIVATED_BY_HR` on the server. */
export type MemberEndBody = z.input<typeof MemberEndRequestSchema>;

/** Body of `POST /ops/emergency-access`; `durationMinutes` defaults to the four-hour ceiling. */
export type EmergencyAccessRequestBody = z.input<typeof EmergencyAccessCreateRequestSchema>;

function send(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  };
}

/** `?a=1&b=2` from the defined, non-empty entries; empty string when none remain. */
function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const seg = encodeURIComponent;

function buildCommon(client: ApiClient, prefix: (orgId: string) => string) {
  const orgPath = prefix;
  return {
    /** GET .../invitations — pending invitations, newest first, paged by cursor. */
    listInvitations: (orgId: string, query: InvitationListParams = {}) =>
      client.request(`${orgPath(orgId)}/invitations${queryString({ ...query })}`, {
        method: 'GET',
        schema: InvitationListResponseSchema,
      }),

    /** POST .../invitations — invite one person (outside production the response carries `devToken`). */
    createInvitation: (orgId: string, body: InvitationCreateRequest) =>
      client.request(`${orgPath(orgId)}/invitations`, {
        ...send('POST', body),
        schema: InvitationCreateResponseSchema,
      }),

    /** POST .../invitations/import — invite up to 500 people; reports created, skipped and errors. */
    importInvitations: (orgId: string, body: InvitationImportRequest) =>
      client.request(`${orgPath(orgId)}/invitations/import`, {
        ...send('POST', body),
        schema: InvitationImportResponseSchema,
      }),

    /** DELETE .../invitations/:invitationId — revoke (idempotent). */
    revokeInvitation: (orgId: string, invitationId: string) =>
      client.request(`${orgPath(orgId)}/invitations/${seg(invitationId)}`, {
        method: 'DELETE',
        schema: InvitationResponseSchema,
      }),

    /** POST .../members/:membershipId/end — end a membership (step-up class administration). */
    endMember: (orgId: string, membershipId: string, body: MemberEndBody = {}) =>
      client.request(`${orgPath(orgId)}/members/${seg(membershipId)}/end`, {
        ...send('POST', body),
        schema: MemberEndResponseSchema,
      }),

    /** GET .../members — paged member list. */
    listMembers: (orgId: string, query: Partial<MemberListQuery> = {}) =>
      client.request(`${orgPath(orgId)}/members${queryString({ ...query })}`, {
        method: 'GET',
        schema: MemberListResponseSchema,
      }),

    /** GET .../grants — grants of the organization. */
    listGrants: (orgId: string, query: GrantListParams = {}) =>
      client.request(`${orgPath(orgId)}/grants${queryString({ ...query })}`, {
        method: 'GET',
        schema: GrantListResponseSchema,
      }),

    /** POST .../grants — create a grant from a template. */
    createGrant: (orgId: string, body: GrantCreateRequest) =>
      client.request(`${orgPath(orgId)}/grants`, {
        ...send('POST', body),
        schema: GrantResponseSchema,
      }),

    /** POST .../grants/:grantId/revoke — revoke with a reason. */
    revokeGrant: (orgId: string, grantId: string, body: GrantRevokeRequest) =>
      client.request(`${orgPath(orgId)}/grants/${encodeURIComponent(grantId)}/revoke`, {
        ...send('POST', body),
        schema: GrantResponseSchema,
      }),

    /** GET .../grants/preview?userId= — effective actions of a user in the org. */
    previewAccess: (orgId: string, userId: string) =>
      client.request(`${orgPath(orgId)}/grants/preview${queryString({ userId })}`, {
        method: 'GET',
        schema: GrantPreviewResponseSchema,
      }),

    /**
     * POST .../grants/transfer-ownership — hand `employer_owner` to another
     * active member. The org route requires the caller to be the current
     * owner; the ops route lets staff set the owner (and the first one).
     */
    transferOwnership: (orgId: string, body: OwnershipTransferRequest) =>
      client.request(`${orgPath(orgId)}/grants/transfer-ownership`, {
        ...send('POST', body),
        schema: OwnershipTransferResponseSchema,
      }),
  };
}

function buildOrgOnly(client: ApiClient, prefix: (orgId: string) => string) {
  return {
    /** GET /orgs/:orgId/org-units — the org-unit tree as a flat list. */
    listOrgUnits: async (orgId: string) => {
      const res = await client.request(`${prefix(orgId)}/org-units`, {
        method: 'GET',
        schema: OrgUnitListResponseSchema,
      });
      return res.items;
    },

    /** POST /orgs/:orgId/org-units — create a department or team under a parent. */
    createOrgUnit: (orgId: string, body: OrgUnitCreateRequest) =>
      client.request(`${prefix(orgId)}/org-units`, {
        ...send('POST', body),
        schema: OrgUnitResponseSchema,
      }),

    /** PATCH /orgs/:orgId/org-units/:unitId — rename or change the cost-center code. */
    updateOrgUnit: (orgId: string, unitId: string, body: OrgUnitUpdateRequest) =>
      client.request(`${prefix(orgId)}/org-units/${seg(unitId)}`, {
        ...send('PATCH', body),
        schema: OrgUnitResponseSchema,
      }),

    /** POST /orgs/:orgId/org-units/:unitId/move — move under another parent. */
    moveOrgUnit: (orgId: string, unitId: string, body: OrgUnitMoveRequest) =>
      client.request(`${prefix(orgId)}/org-units/${seg(unitId)}/move`, {
        ...send('POST', body),
        schema: OrgUnitResponseSchema,
      }),

    /** PATCH /orgs/:orgId/members/:membershipId — move to an org unit, cost center or line manager. */
    updateMember: (orgId: string, membershipId: string, body: MemberUpdateRequest) =>
      client.request(`${prefix(orgId)}/members/${seg(membershipId)}`, {
        ...send('PATCH', body),
        schema: MemberItemSchema,
      }),

    /** PATCH /orgs/:orgId/grants/:grantId — change conditions or validity. */
    updateGrant: (orgId: string, grantId: string, body: GrantUpdateRequest) =>
      client.request(`${prefix(orgId)}/grants/${encodeURIComponent(grantId)}`, {
        ...send('PATCH', body),
        schema: GrantResponseSchema,
      }),

    /** POST /orgs/:orgId/grants/delegate — delegate part of a grant. */
    delegateGrant: (orgId: string, body: GrantDelegateRequest) =>
      client.request(`${prefix(orgId)}/grants/delegate`, {
        ...send('POST', body),
        schema: GrantResponseSchema,
      }),

    /** GET /orgs/:orgId/approval-authorities */
    listApprovalAuthorities: (orgId: string) =>
      client.request(`${prefix(orgId)}/approval-authorities`, {
        method: 'GET',
        schema: ApprovalAuthorityListResponseSchema,
      }),

    /** POST /orgs/:orgId/approval-authorities */
    createApprovalAuthority: (orgId: string, body: ApprovalAuthorityCreateRequest) =>
      client.request(`${prefix(orgId)}/approval-authorities`, {
        ...send('POST', body),
        schema: ApprovalAuthorityResponseSchema,
      }),

    /** PATCH /orgs/:orgId/approval-authorities/:id */
    updateApprovalAuthority: (orgId: string, id: string, body: ApprovalAuthorityUpdateRequest) =>
      client.request(`${prefix(orgId)}/approval-authorities/${encodeURIComponent(id)}`, {
        ...send('PATCH', body),
        schema: ApprovalAuthorityResponseSchema,
      }),
  };
}

function buildOpsOnly(client: ApiClient) {
  return {
    /** GET /ops/grants — platform-level grants (no organization). */
    listPlatformGrants: (query: GrantListParams = {}) =>
      client.request(`/api/ops/grants${queryString({ ...query })}`, {
        method: 'GET',
        schema: GrantListResponseSchema,
      }),

    /** POST /ops/grants — create a platform-level grant. */
    createPlatformGrant: (body: PlatformGrantCreateRequest) =>
      client.request('/api/ops/grants', {
        ...send('POST', body),
        schema: GrantResponseSchema,
      }),

    /** POST /ops/grants/:grantId/revoke — revoke a platform-level grant with a reason. */
    revokePlatformGrant: (grantId: string, body: GrantRevokeRequest) =>
      client.request(`/api/ops/grants/${encodeURIComponent(grantId)}/revoke`, {
        ...send('POST', body),
        schema: GrantResponseSchema,
      }),

    /** GET /ops/users/:userId/access — evaluated access of a user in every context. */
    userAccess: (userId: string) =>
      client.request(`/api/ops/users/${encodeURIComponent(userId)}/access`, {
        method: 'GET',
        schema: UserAccessResponseSchema,
      }),

    /** GET /ops/organizations — employer clients by name, with search and cursor. */
    listOrganizations: (query: OrganizationListParams = {}) =>
      client.request(`/api/ops/organizations${queryString({ ...query })}`, {
        method: 'GET',
        schema: OrganizationListResponseSchema,
      }),

    /** GET /ops/organizations/:orgId — one employer client. */
    getOrganization: (orgId: string) =>
      client.request(`/api/ops/organizations/${seg(orgId)}`, {
        method: 'GET',
        schema: OrganizationResponseSchema,
      }),

    /** POST /ops/users/:userId/suspend — suspend a user with a reason (step-up class administration). */
    suspendUser: (userId: string, body: UserSuspendRequest) =>
      client.request(`/api/ops/users/${seg(userId)}/suspend`, {
        ...send('POST', body),
        schema: UserSuspendResponseSchema,
      }),

    /** POST /ops/users/:userId/reinstate — lift a suspension. */
    reinstateUser: (userId: string) =>
      client.request(`/api/ops/users/${seg(userId)}/reinstate`, {
        method: 'POST',
        schema: UserReinstateResponseSchema,
      }),

    /** GET /ops/emergency-access — requests and grants, optionally for one requester. */
    listEmergencyAccess: (query: EmergencyAccessListParams = {}) =>
      client.request(`/api/ops/emergency-access${queryString({ ...query })}`, {
        method: 'GET',
        schema: EmergencyAccessListResponseSchema,
      }),

    /** POST /ops/emergency-access — request access to one case or one user's records. */
    requestEmergencyAccess: (body: EmergencyAccessRequestBody) =>
      client.request('/api/ops/emergency-access', {
        ...send('POST', body),
        schema: EmergencyAccessResponseSchema,
      }),

    /** POST /ops/emergency-access/:id/approve — a second staff member approves; the window starts now. */
    approveEmergencyAccess: (id: string) =>
      client.request(`/api/ops/emergency-access/${seg(id)}/approve`, {
        method: 'POST',
        schema: EmergencyAccessResponseSchema,
      }),

    /** POST /ops/emergency-access/:id/deny — deny a pending request (204). */
    denyEmergencyAccess: (id: string) =>
      client.request(`/api/ops/emergency-access/${seg(id)}/deny`, {
        method: 'POST',
        schema: z.undefined(),
        expectBody: false,
      }),

    /** POST /ops/emergency-access/:id/revoke — end an approved window early. */
    revokeEmergencyAccess: (id: string) =>
      client.request(`/api/ops/emergency-access/${seg(id)}/revoke`, {
        method: 'POST',
        schema: EmergencyAccessResponseSchema,
      }),

    /** GET /ops/emergency-access/:id/records/:recordType/:recordId — one audited record read. */
    readEmergencyRecord: (id: string, recordType: EmergencyRecordType, recordId: string) =>
      client.request(
        `/api/ops/emergency-access/${seg(id)}/records/${seg(recordType)}/${seg(recordId)}`,
        { method: 'GET', schema: EmergencyRecordResponseSchema },
      ),
  };
}

const orgPrefix = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`;
const opsPrefix = (orgId: string) => `/api/ops/orgs/${encodeURIComponent(orgId)}`;

/** Organization workspace surface: every `/api/orgs/:orgId/...` route. */
export type OrgAdminApi = ReturnType<typeof buildCommon> & ReturnType<typeof buildOrgOnly>;

/** Operations surface: the ops org mirrors plus the platform-level routes. */
export type OpsAdminApi = ReturnType<typeof buildCommon> & ReturnType<typeof buildOpsOnly>;

export function createOrgAdminApi(client: ApiClient, base: { kind: 'org' }): OrgAdminApi;
export function createOrgAdminApi(client: ApiClient, base: { kind: 'ops' }): OpsAdminApi;
export function createOrgAdminApi(client: ApiClient, base: OrgAdminBase): OrgAdminApi | OpsAdminApi;
export function createOrgAdminApi(
  client: ApiClient,
  base: OrgAdminBase,
): OrgAdminApi | OpsAdminApi {
  if (base.kind === 'ops') {
    return { ...buildCommon(client, opsPrefix), ...buildOpsOnly(client) };
  }
  return { ...buildCommon(client, orgPrefix), ...buildOrgOnly(client, orgPrefix) };
}
