/**
 * Suspend and reinstate a user from the operations workspace
 * (`POST /ops/users/:userId/suspend|reinstate`, `people.deactivate`, step-up
 * class administration). Both go through `withStepUp` and refetch the user
 * access lookup on success, so the state shown is the server's.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OpsAdminApi } from '@nestself/api-client';
import { useAuth, withStepUp } from '../../auth';
import { accessKeys } from '../access/use-ops-admin';

function useUserMutation<TBody, TResult>(userId: string, call: (body: TBody) => Promise<TResult>) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accessKeys.userAccess(userId) }),
  });
}

export function useSuspendUser(opsApi: OpsAdminApi, userId: string) {
  return useUserMutation(userId, (reason: string) => opsApi.suspendUser(userId, { reason }));
}

export function useReinstateUser(opsApi: OpsAdminApi, userId: string) {
  return useUserMutation(userId, (_: void) => opsApi.reinstateUser(userId));
}
