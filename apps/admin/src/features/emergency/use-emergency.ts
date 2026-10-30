/**
 * TanStack Query hooks over the operations emergency access routes
 * (`/ops/emergency-access`). Every mutation goes through `withStepUp`
 * (emergency step-up class for request, approve, deny and revoke; restricted
 * class for a record read), so a `step_up_required` answer opens the
 * step-up dialog and retries once.
 *
 * The record read is a mutation with `gcTime: 0`: its body is confidential,
 * is never written to the query cache, and is dropped as soon as the viewer
 * resets it (on close) or unmounts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmergencyAccessRequestBody, OpsAdminApi } from '@nestself/api-client';
import type { EmergencyRecordType } from '@nestself/contracts';
import { useAuth, withStepUp } from '../../auth';

export const emergencyKeys = {
  list: ['ops-admin', 'emergency-access'] as const,
};

export function useEmergencyAccessList(opsApi: OpsAdminApi, enabled: boolean) {
  return useQuery({
    queryKey: emergencyKeys.list,
    queryFn: async () => (await opsApi.listEmergencyAccess()).items,
    enabled,
  });
}

function useEmergencyMutation<TBody, TResult>(call: (body: TBody) => Promise<TResult>) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emergencyKeys.list }),
  });
}

export function useRequestEmergencyAccess(opsApi: OpsAdminApi) {
  return useEmergencyMutation((body: EmergencyAccessRequestBody) => opsApi.requestEmergencyAccess(body));
}

export type EmergencyDecision = 'approve' | 'deny' | 'revoke';

/** Approve or deny a pending request, or revoke an active window, by id. */
export function useEmergencyDecision(opsApi: OpsAdminApi, decision: EmergencyDecision) {
  return useEmergencyMutation(async (id: string): Promise<void> => {
    if (decision === 'approve') await opsApi.approveEmergencyAccess(id);
    else if (decision === 'deny') await opsApi.denyEmergencyAccess(id);
    else await opsApi.revokeEmergencyAccess(id);
  });
}

export interface EmergencyRecordRequest {
  recordType: EmergencyRecordType;
  recordId: string;
}

/** One audited record read under the caller's own access record; never cached. */
export function useReadEmergencyRecord(opsApi: OpsAdminApi, emergencyAccessId: string) {
  const { stepUp } = useAuth();
  return useMutation({
    mutationFn: ({ recordType, recordId }: EmergencyRecordRequest) =>
      withStepUp(stepUp, () => opsApi.readEmergencyRecord(emergencyAccessId, recordType, recordId)),
    gcTime: 0,
  });
}
