/**
 * TanStack Query hooks over the organization administration API
 * (`createOrgAdminApi(api, { kind: 'org' })`). Mutations go through
 * `withStepUp`, so a `step_up_required` answer opens the step-up dialog and
 * retries once; a cancelled step-up rejects with `StepUpCancelledError`.
 *
 * Passing `orgId: null` disables the queries (sample mode, or while the
 * principal is not yet in the organization context).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createOrgAdminApi } from '@nestself/api-client';
import type { OrgAdminApi } from '@nestself/api-client';
import type {
  GrantCreateRequest,
  GrantDelegateRequest,
  GrantRevokeRequest,
} from '@nestself/contracts';
import { api } from '../../api';
import { useAuth, withStepUp } from '../../auth';
import type { AccessMember, AccessOrgUnit } from './access-labels';

export const orgAdminApi: OrgAdminApi = createOrgAdminApi(api, { kind: 'org' });

/** Members per request; the member list route caps the page size at 100. */
const MEMBER_PAGE_SIZE = 100;

export const accessKeys = {
  org: (orgId: string) => ['org-admin', orgId] as const,
  grants: (orgId: string) => ['org-admin', orgId, 'grants'] as const,
  members: (orgId: string) => ['org-admin', orgId, 'members'] as const,
  orgUnits: (orgId: string) => ['org-admin', orgId, 'org-units'] as const,
  preview: (orgId: string, userId: string) => ['org-admin', orgId, 'preview', userId] as const,
};

export function useGrants(adminApi: OrgAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: accessKeys.grants(orgId ?? ''),
    queryFn: async () => (await adminApi.listGrants(orgId!, { includeRevoked: true })).items,
    enabled: orgId !== null,
  });
}

export function useMembers(adminApi: OrgAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: accessKeys.members(orgId ?? ''),
    queryFn: async (): Promise<AccessMember[]> => {
      const page = await adminApi.listMembers(orgId!, { status: 'ACTIVE', limit: MEMBER_PAGE_SIZE });
      return page.items.map((m) => ({ userId: m.userId, displayName: m.displayName }));
    },
    enabled: orgId !== null,
  });
}

export function useOrgUnits(adminApi: OrgAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: accessKeys.orgUnits(orgId ?? ''),
    queryFn: async (): Promise<AccessOrgUnit[]> =>
      (await adminApi.listOrgUnits(orgId!))
        .filter((u) => u.archivedAt === null)
        .map((u) => ({ id: u.id, name: u.name })),
    enabled: orgId !== null,
  });
}

export function usePreviewAccess(adminApi: OrgAdminApi, orgId: string | null, userId: string | null) {
  return useQuery({
    queryKey: accessKeys.preview(orgId ?? '', userId ?? ''),
    queryFn: async () => (await adminApi.previewAccess(orgId!, userId!)).actions,
    enabled: orgId !== null && userId !== null,
  });
}

/** Wraps a grant mutation in step-up and refreshes the organization's access data. */
function useGrantMutation<TBody, TResult>(call: (body: TBody) => Promise<TResult>, orgId: string) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accessKeys.org(orgId) }),
  });
}

export function useCreateGrant(adminApi: OrgAdminApi, orgId: string) {
  return useGrantMutation((body: GrantCreateRequest) => adminApi.createGrant(orgId, body), orgId);
}

export function useRevokeGrant(adminApi: OrgAdminApi, orgId: string) {
  return useGrantMutation(
    ({ grantId, ...body }: GrantRevokeRequest & { grantId: string }) =>
      adminApi.revokeGrant(orgId, grantId, body),
    orgId,
  );
}

export function useDelegateGrant(adminApi: OrgAdminApi, orgId: string) {
  return useGrantMutation((body: GrantDelegateRequest) => adminApi.delegateGrant(orgId, body), orgId);
}
