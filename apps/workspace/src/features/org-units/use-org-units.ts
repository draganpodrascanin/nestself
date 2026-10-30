/**
 * Org-unit mutations (`org_units.manage`) through `withStepUp`; each refreshes
 * the organization's admin data (the unit list and the people tables naming
 * units).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrgAdminApi } from '@nestself/api-client';
import type { OrgUnitCreateRequest } from '@nestself/contracts';
import { useAuth, withStepUp } from '../../auth';
import { peopleKeys } from '../people/use-people';

function useUnitMutation<TBody, TResult>(call: (body: TBody) => Promise<TResult>, orgId: string) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: peopleKeys.org(orgId) }),
  });
}

export function useCreateOrgUnit(adminApi: OrgAdminApi, orgId: string) {
  return useUnitMutation((body: OrgUnitCreateRequest) => adminApi.createOrgUnit(orgId, body), orgId);
}

export function useRenameOrgUnit(adminApi: OrgAdminApi, orgId: string) {
  return useUnitMutation(
    ({ unitId, name }: { unitId: string; name: string }) => adminApi.updateOrgUnit(orgId, unitId, { name }),
    orgId,
  );
}

export function useMoveOrgUnit(adminApi: OrgAdminApi, orgId: string) {
  return useUnitMutation(
    ({ unitId, parentId }: { unitId: string; parentId: string }) => adminApi.moveOrgUnit(orgId, unitId, { parentId }),
    orgId,
  );
}
