/**
 * TanStack Query hooks over the operations SSO connection routes
 * (`/ops/sso-connections`). Every route needs `sso.manage`, an
 * administration step-up action, so every mutation goes through
 * `withStepUp`: a `step_up_required` answer opens the step-up dialog and
 * retries once. Every outcome refreshes the connection list: a failure
 * (`sso_connection_state`, `conflict`, `not_found`) usually means the row on
 * screen was stale, and the error copy says the list was refreshed.
 *
 * `gcTime: 0` drops a settled mutation, and with it its `variables` (an
 * OIDC client secret) and `data` (a single-use test start URL), from the
 * mutation cache as soon as no component observes it; the dialogs also
 * `reset()` after success.
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ssoKeys.list }),
    gcTime: 0,
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
