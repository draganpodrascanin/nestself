/**
 * Typed wrappers for organization administration: members, org units, grants
 * and approval authorities (auth-strategy.md section 5.3) and their
 * operations mirrors (section 5.4).
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
  GrantListResponseSchema,
  GrantPreviewResponseSchema,
  GrantResponseSchema,
  MemberListResponseSchema,
  OrgUnitResponseSchema,
  UserAccessResponseSchema,
} from '@nestself/contracts';
import type {
  ApprovalAuthorityCreateRequest,
  ApprovalAuthorityUpdateRequest,
  GrantCreateRequest,
  GrantDelegateRequest,
  GrantRevokeRequest,
  GrantUpdateRequest,
  MemberListQuery,
  PlatformGrantCreateRequest,
} from '@nestself/contracts';
import type { ApiClient } from './client';

export type OrgAdminBase = { kind: 'org' } | { kind: 'ops' };

/** Query of the grant list routes (`GrantListQuerySchema` in the API). */
export interface GrantListParams {
  subjectUserId?: string;
  includeRevoked?: boolean;
}

const OrgUnitListSchema = z.object({ items: z.array(OrgUnitResponseSchema) });

function send(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  };
}

/** `?a=1&b=2` from the defined entries; empty string when none are defined. */
function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function buildCommon(client: ApiClient, prefix: (orgId: string) => string) {
  const orgPath = prefix;
  return {
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
  };
}

function buildOrgOnly(client: ApiClient, prefix: (orgId: string) => string) {
  return {
    /** GET /orgs/:orgId/org-units — the org-unit tree as a flat list. */
    listOrgUnits: async (orgId: string) => {
      const res = await client.request(`${prefix(orgId)}/org-units`, {
        method: 'GET',
        schema: OrgUnitListSchema,
      });
      return res.items;
    },

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

    /** GET /ops/users/:userId/access — evaluated access of a user in every context. */
    userAccess: (userId: string) =>
      client.request(`/api/ops/users/${encodeURIComponent(userId)}/access`, {
        method: 'GET',
        schema: UserAccessResponseSchema,
      }),
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
