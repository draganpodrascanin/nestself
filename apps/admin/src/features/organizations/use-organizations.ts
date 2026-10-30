/**
 * TanStack Query hooks over the operations client list
 * (`GET /ops/organizations`, platform staff only) and one client
 * (`GET /ops/organizations/:orgId`, also open to staff assigned to it).
 *
 * The list and the detail are cached under different keys
 * (`organization-list` / `organization`): they hold different shapes and
 * must never share one.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { OpsAdminApi } from '@nestself/api-client';
import { accessKeys } from '../access/use-ops-admin';

/** Rows per page of the client list. */
export const ORGANIZATION_PAGE_SIZE = 25;

export function useOrganizationPages(opsApi: OpsAdminApi, enabled: boolean, search: string) {
  return useInfiniteQuery({
    queryKey: accessKeys.organizationList(search),
    queryFn: ({ pageParam }) =>
      opsApi.listOrganizations({
        limit: ORGANIZATION_PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(search ? { search } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** One client; `orgId: null` disables the query (sample mode, or before the context switch). */
export function useOrganization(opsApi: OpsAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: accessKeys.organization(orgId ?? ''),
    queryFn: () => opsApi.getOrganization(orgId!),
    enabled: orgId !== null,
  });
}
