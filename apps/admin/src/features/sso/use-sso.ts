/**
 * TanStack Query hooks over the operations SSO connection routes
 * (`/ops/sso-connections`). Every route needs `sso.manage`, an
 * administration step-up action, so every mutation goes through
 * `withStepUp`: a `step_up_required` answer opens the step-up dialog and
 * retries once. Each success refreshes the connection list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpsAdminApi, SsoConnectionCreateBody } from '@nestself/api-client';
import type { SsoConnectionUpdateRequest } from '@nestself/contracts';
import { useAuth, withStepUp } from '../../auth';

export const ssoKeys = {
  list: ['ops-admin', 'sso-connections'] as const,
};

export function useSsoConnections(opsApi: OpsAdminApi, enabled: boolean) {
  return useQuery({
    queryKey: ssoKeys.list,
    queryFn: async () => (await opsApi.listSsoConnections()).items,
    enabled,
  });
}

function useSsoMutation<TVars, TResult>(call: (vars: TVars) => Promise<TResult>) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => withStepUp(stepUp, () => call(vars)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ssoKeys.list }),
  });
}

export function useCreateSsoConnection(opsApi: OpsAdminApi) {
  return useSsoMutation((body: SsoConnectionCreateBody) => opsApi.createSsoConnection(body));
}

export function useUpdateSsoConnection(opsApi: OpsAdminApi) {
  return useSsoMutation(({ id, body }: { id: string; body: SsoConnectionUpdateRequest }) =>
    opsApi.updateSsoConnection(id, body),
  );
}

export function useAddSsoDomain(opsApi: OpsAdminApi) {
  return useSsoMutation(({ id, domain }: { id: string; domain: string }) => opsApi.addSsoDomain(id, { domain }));
}

export function useVerifySsoDomain(opsApi: OpsAdminApi) {
  return useSsoMutation(({ id, domainId }: { id: string; domainId: string }) => opsApi.verifySsoDomain(id, domainId));
}

export function useTestSsoConnection(opsApi: OpsAdminApi) {
  return useSsoMutation((id: string) => opsApi.testSsoConnection(id));
}

export function useActivateSsoConnection(opsApi: OpsAdminApi) {
  return useSsoMutation((id: string) => opsApi.activateSsoConnection(id));
}
