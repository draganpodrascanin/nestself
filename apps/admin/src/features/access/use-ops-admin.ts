/**
 * TanStack Query hooks over the operations administration API
 * (`createOrgAdminApi(api, { kind: 'ops' })`). Mutations go through
 * `withStepUp`, so a `step_up_required` answer opens the step-up dialog and
 * retries once; a cancelled step-up rejects with `StepUpCancelledError`.
 *
 * Passing `null` for the organization or user disables a query (sample mode,
 * or while the session is not yet in the operations context).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createOrgAdminApi } from '@nestself/api-client';
import type { OpsAdminApi } from '@nestself/api-client';
import type {
  GrantCreateRequest,
  GrantRevokeRequest,
  PlatformGrantCreateRequest,
} from '@nestself/contracts';
import { api } from '../../api';
import { useAuth, withStepUp } from '../../auth';
import { accessErrorKey } from './access-errors';
import type { AccessErrorKey } from './access-errors';
import type { AccessMember } from './access-labels';

export const opsAdminApi: OpsAdminApi = createOrgAdminApi(api, { kind: 'ops' });

/** Members per request; the member list route caps the page size at 100. */
const MEMBER_PAGE_SIZE = 100;

export const accessKeys = {
  all: ['ops-admin'] as const,
  orgGrants: (orgId: string) => ['ops-admin', 'org', orgId, 'grants'] as const,
  orgMembers: (orgId: string) => ['ops-admin', 'org', orgId, 'members'] as const,
  platformGrants: ['ops-admin', 'platform', 'grants'] as const,
  userAccess: (userId: string) => ['ops-admin', 'user-access', userId] as const,
};

/**
 * Every `/ops/*` route needs the operations context. When the session is in
 * another one, this switches once (never again on re-render) and reports a
 * failed switch. `ready` is true once the principal is in that context.
 */
export function useOperationsContext(sampleMode: boolean): { ready: boolean; error: AccessErrorKey | null } {
  const { principal, switchContext } = useAuth();
  const inOperations = principal?.context.kind === 'operations';
  const switchRequested = useRef(false);
  const [error, setError] = useState<AccessErrorKey | null>(null);

  useEffect(() => {
    if (sampleMode || !principal || inOperations || switchRequested.current) return;
    switchRequested.current = true;
    switchContext({ kind: 'operations' }).catch((err: unknown) => {
      setError(accessErrorKey(err) ?? 'unknown');
    });
  }, [sampleMode, principal, inOperations, switchContext]);

  return { ready: !sampleMode && inOperations, error: sampleMode ? null : error };
}

export function useOrgGrants(opsApi: OpsAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: accessKeys.orgGrants(orgId ?? ''),
    queryFn: async () => (await opsApi.listGrants(orgId!, { includeRevoked: true })).items,
    enabled: orgId !== null,
  });
}

export function useOrgMembers(opsApi: OpsAdminApi, orgId: string | null) {
  return useQuery({
    queryKey: accessKeys.orgMembers(orgId ?? ''),
    queryFn: async (): Promise<AccessMember[]> => {
      const page = await opsApi.listMembers(orgId!, { status: 'ACTIVE', limit: MEMBER_PAGE_SIZE });
      return page.items.map((m) => ({ userId: m.userId, displayName: m.displayName }));
    },
    enabled: orgId !== null,
  });
}

export function usePlatformGrants(opsApi: OpsAdminApi, enabled: boolean) {
  return useQuery({
    queryKey: accessKeys.platformGrants,
    queryFn: async () => (await opsApi.listPlatformGrants({ includeRevoked: true })).items,
    enabled,
  });
}

export function useUserAccess(opsApi: OpsAdminApi, userId: string | null) {
  return useQuery({
    queryKey: accessKeys.userAccess(userId ?? ''),
    queryFn: async () => (await opsApi.userAccess(userId!)).contexts,
    enabled: userId !== null,
  });
}

/** Wraps a grant mutation in step-up and refreshes every operations access query. */
function useGrantMutation<TBody, TResult>(call: (body: TBody) => Promise<TResult>) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accessKeys.all }),
  });
}

export function useCreateOrgGrant(opsApi: OpsAdminApi, orgId: string) {
  return useGrantMutation((body: GrantCreateRequest) => opsApi.createGrant(orgId, body));
}

export function useRevokeOrgGrant(opsApi: OpsAdminApi, orgId: string) {
  return useGrantMutation(({ grantId, ...body }: GrantRevokeRequest & { grantId: string }) =>
    opsApi.revokeGrant(orgId, grantId, body),
  );
}

export function useCreatePlatformGrant(opsApi: OpsAdminApi) {
  return useGrantMutation((body: PlatformGrantCreateRequest) => opsApi.createPlatformGrant(body));
}
