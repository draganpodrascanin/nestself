/**
 * TanStack Query hooks for the operations People tab over the ops mirrors
 * (`/ops/orgs/:orgId/members|invitations`). Lists page by the API cursor and
 * append on "Load more" (never capped silently). Mutations go through
 * `withStepUp`, so a `step_up_required` answer opens the step-up dialog and
 * retries once; a cancelled step-up rejects with `StepUpCancelledError`.
 *
 * Keys sit under `['ops-admin', 'org', orgId, 'people', ...]`, apart from the
 * access screen's `members` entry (a name list, a different shape). A
 * mutation refreshes everything under `['ops-admin', 'org', orgId]`, so the
 * owner card and the access tab follow an ended membership too.
 *
 * Passing `orgId: null` disables the queries (sample mode, before the
 * operations context switch, or without the action the route needs).
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OpsAdminApi } from '@nestself/api-client';
import type { InvitationCreateRequest, InvitationImportRequest, MembershipEndedReason } from '@nestself/contracts';
import { useAuth, withStepUp } from '../../auth';
import type { MemberStatus } from './people-labels';

/** Rows per page of the member and invitation tables. */
export const PEOPLE_PAGE_SIZE = 25;

export interface MemberFilters {
  status: MemberStatus | null;
  search: string;
}

export const opsPeopleKeys = {
  org: (orgId: string) => ['ops-admin', 'org', orgId] as const,
  members: (orgId: string, filters: MemberFilters) => ['ops-admin', 'org', orgId, 'people', 'members', filters] as const,
  invitations: (orgId: string) => ['ops-admin', 'org', orgId, 'people', 'invitations'] as const,
};

export function useMemberPages(opsApi: OpsAdminApi, orgId: string | null, filters: MemberFilters) {
  return useInfiniteQuery({
    queryKey: opsPeopleKeys.members(orgId ?? '', filters),
    queryFn: ({ pageParam }) =>
      opsApi.listMembers(orgId!, {
        limit: PEOPLE_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: orgId !== null,
  });
}

export function useInvitationPages(opsApi: OpsAdminApi, orgId: string | null) {
  return useInfiniteQuery({
    queryKey: opsPeopleKeys.invitations(orgId ?? ''),
    queryFn: ({ pageParam }) =>
      opsApi.listInvitations(orgId!, {
        limit: PEOPLE_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: orgId !== null,
  });
}

/** Wraps a mutation in step-up and refreshes the organization's operations data. */
function usePeopleMutation<TBody, TResult>(call: (body: TBody) => Promise<TResult>, orgId: string) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: opsPeopleKeys.org(orgId) }),
  });
}

export function useEndMember(opsApi: OpsAdminApi, orgId: string) {
  return usePeopleMutation(
    ({ membershipId, reason }: { membershipId: string; reason: MembershipEndedReason }) =>
      opsApi.endMember(orgId, membershipId, { reason }),
    orgId,
  );
}

export function useCreateInvitation(opsApi: OpsAdminApi, orgId: string) {
  return usePeopleMutation((body: InvitationCreateRequest) => opsApi.createInvitation(orgId, body), orgId);
}

export function useImportInvitations(opsApi: OpsAdminApi, orgId: string) {
  return usePeopleMutation((body: InvitationImportRequest) => opsApi.importInvitations(orgId, body), orgId);
}

export function useRevokeInvitation(opsApi: OpsAdminApi, orgId: string) {
  return usePeopleMutation((invitationId: string) => opsApi.revokeInvitation(orgId, invitationId), orgId);
}
