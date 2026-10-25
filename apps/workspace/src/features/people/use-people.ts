/**
 * TanStack Query hooks for the HR People screen over the organization
 * administration API. Lists page by the API cursor and append on "Load more"
 * (never capped silently). Mutations go through `withStepUp`, so a
 * `step_up_required` answer opens the step-up dialog and retries once; a
 * cancelled step-up rejects with `StepUpCancelledError`.
 *
 * Passing `orgId: null` disables the queries (sample mode, or while the
 * principal is not yet in the organization context).
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrgAdminApi } from '@nestself/api-client';
import type {
  InvitationCreateRequest,
  InvitationImportRequest,
  MemberItem,
  MemberUpdateRequest,
  MembershipEndedReason,
} from '@nestself/contracts';
import { useAuth, withStepUp } from '../../auth';
import type { MemberStatus } from './people-labels';

/** Rows per page of the member and invitation tables. */
export const PEOPLE_PAGE_SIZE = 25;
/** Rows per request when reading every active member (the route's maximum). */
const DIRECTORY_PAGE_SIZE = 100;

export interface MemberFilters {
  orgUnitId: string | null;
  status: MemberStatus | null;
  search: string;
}

export const peopleKeys = {
  org: (orgId: string) => ['org-admin', orgId] as const,
  members: (orgId: string, filters: MemberFilters) => ['org-admin', orgId, 'people', 'members', filters] as const,
  directory: (orgId: string) => ['org-admin', orgId, 'people', 'directory'] as const,
  invitations: (orgId: string) => ['org-admin', orgId, 'people', 'invitations'] as const,
  orgUnits: (orgId: string) => ['org-admin', orgId, 'org-units'] as const,
};

export function useMemberPages(adminApi: OrgAdminApi, orgId: string | null, filters: MemberFilters) {
  return useInfiniteQuery({
    queryKey: peopleKeys.members(orgId ?? '', filters),
    queryFn: ({ pageParam }) =>
      adminApi.listMembers(orgId!, {
        limit: PEOPLE_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(filters.orgUnitId ? { orgUnitId: filters.orgUnitId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: orgId !== null,
  });
}

/**
 * Every active member, read page by page until the cursor runs out. Names the
 * line managers in the table and fills the line manager choice.
 */
export function useActiveMemberDirectory(adminApi: OrgAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: peopleKeys.directory(orgId ?? ''),
    queryFn: async (): Promise<MemberItem[]> => {
      const all: MemberItem[] = [];
      let cursor: string | null = null;
      do {
        const page = await adminApi.listMembers(orgId!, {
          status: 'ACTIVE',
          limit: DIRECTORY_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return all;
    },
    enabled: orgId !== null,
  });
}

export function useInvitationPages(adminApi: OrgAdminApi, orgId: string | null) {
  return useInfiniteQuery({
    queryKey: peopleKeys.invitations(orgId ?? ''),
    queryFn: ({ pageParam }) =>
      adminApi.listInvitations(orgId!, {
        limit: PEOPLE_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: orgId !== null,
  });
}

export function useOrgUnitList(adminApi: OrgAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: peopleKeys.orgUnits(orgId ?? ''),
    queryFn: () => adminApi.listOrgUnits(orgId!),
    enabled: orgId !== null,
  });
}

/** Wraps a mutation in step-up and refreshes the organization's admin data. */
function usePeopleMutation<TBody, TResult>(call: (body: TBody) => Promise<TResult>, orgId: string) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: peopleKeys.org(orgId) }),
  });
}

export function useUpdateMember(adminApi: OrgAdminApi, orgId: string) {
  return usePeopleMutation(
    ({ membershipId, ...body }: MemberUpdateRequest & { membershipId: string }) =>
      adminApi.updateMember(orgId, membershipId, body),
    orgId,
  );
}

export function useEndMember(adminApi: OrgAdminApi, orgId: string) {
  return usePeopleMutation(
    ({ membershipId, reason }: { membershipId: string; reason: MembershipEndedReason }) =>
      adminApi.endMember(orgId, membershipId, { reason }),
    orgId,
  );
}

export function useCreateInvitation(adminApi: OrgAdminApi, orgId: string) {
  return usePeopleMutation((body: InvitationCreateRequest) => adminApi.createInvitation(orgId, body), orgId);
}

export function useImportInvitations(adminApi: OrgAdminApi, orgId: string) {
  return usePeopleMutation((body: InvitationImportRequest) => adminApi.importInvitations(orgId, body), orgId);
}

export function useRevokeInvitation(adminApi: OrgAdminApi, orgId: string) {
  return usePeopleMutation((invitationId: string) => adminApi.revokeInvitation(orgId, invitationId), orgId);
}
