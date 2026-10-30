/**
 * The one org-unit query of the workspace. The cache always holds the full
 * `OrgUnitResponse[]` the API returns (archived units included) under
 * `['org-admin', orgId, 'org-units']`; screens that need a narrower view
 * derive it with `select`, so two screens never write different shapes to
 * the same key.
 *
 * Passing `orgId: null` disables the query.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { OrgAdminApi } from '@nestself/api-client';
import type { OrgUnitResponse } from '@nestself/contracts';

export const orgUnitsKey = (orgId: string) => ['org-admin', orgId, 'org-units'] as const;

export function orgUnitsQuery(adminApi: OrgAdminApi, orgId: string | null) {
  return queryOptions({
    queryKey: orgUnitsKey(orgId ?? ''),
    queryFn: (): Promise<OrgUnitResponse[]> => adminApi.listOrgUnits(orgId!),
    enabled: orgId !== null,
  });
}

/** Every org unit of the organization, archived ones included. */
export function useOrgUnitList(adminApi: OrgAdminApi, orgId: string | null) {
  return useQuery(orgUnitsQuery(adminApi, orgId));
}
