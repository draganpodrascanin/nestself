/**
 * TanStack Query hooks over the operations listening routes
 * (`/ops/listening/questionnaires` and
 * `/ops/orgs/:orgId/listening/configuration`).
 *
 * `listening.configure` and `listening.templates.publish` are administration
 * step-up actions, and the server checks the step-up on the configuration
 * read too, so those calls go through `withStepUp`: a `step_up_required`
 * answer opens the step-up dialog and retries once. Questionnaire reads and
 * draft edits (`listening.templates.write`) need no step-up. A cancelled
 * step-up changed nothing, so it refreshes nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListeningApi } from '@nestself/api-client';
import type { ListeningConfigurationUpdateRequest, QuestionnaireDraftRequest } from '@nestself/contracts';
import { StepUpCancelledError, useAuth, withStepUp } from '../../auth';

export { useOperationsContext } from '../access/use-ops-admin';

export const listeningOpsKeys = {
  questionnaires: ['ops-admin', 'listening', 'questionnaires'] as const,
  configuration: (orgId: string) => ['ops-admin', 'listening', 'configuration', orgId] as const,
};

export function useQuestionnaires(api: ListeningApi, enabled: boolean) {
  return useQuery({
    queryKey: listeningOpsKeys.questionnaires,
    queryFn: async () => (await api.listQuestionnaires()).items,
    enabled,
  });
}

function useQuestionnaireMutation<TVars, TResult>(call: (vars: TVars) => Promise<TResult>, needsStepUp = false) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => (needsStepUp ? withStepUp(stepUp, () => call(vars)) : call(vars)),
    onSettled: (_data, error) =>
      error instanceof StepUpCancelledError ? undefined : queryClient.invalidateQueries({ queryKey: listeningOpsKeys.questionnaires }),
  });
}

export function useCreateQuestionnaire(api: ListeningApi) {
  return useQuestionnaireMutation((body: QuestionnaireDraftRequest) => api.createQuestionnaire(body));
}

export function useUpdateQuestionnaire(api: ListeningApi) {
  return useQuestionnaireMutation(({ id, body }: { id: string; body: QuestionnaireDraftRequest }) => api.updateQuestionnaire(id, body));
}

export function useSubmitQuestionnaireReview(api: ListeningApi) {
  return useQuestionnaireMutation((id: string) => api.submitQuestionnaireReview(id));
}

export function usePublishQuestionnaire(api: ListeningApi) {
  return useQuestionnaireMutation((id: string) => api.publishQuestionnaire(id), true);
}

export function useArchiveQuestionnaire(api: ListeningApi) {
  return useQuestionnaireMutation((id: string) => api.archiveQuestionnaire(id));
}

/**
 * One client's configuration. Once the user cancelled the step-up of this
 * read, only the screen's Try again asks again: a refetch on window focus
 * does not reopen the dialog.
 */
export function useClientConfiguration(api: ListeningApi, orgId: string | null) {
  const { stepUp } = useAuth();
  return useQuery({
    queryKey: listeningOpsKeys.configuration(orgId ?? ''),
    queryFn: () => withStepUp(stepUp, () => api.opsConfiguration(orgId ?? '')),
    enabled: orgId !== null,
    refetchOnWindowFocus: (query) => !(query.state.error instanceof StepUpCancelledError),
  });
}

export function useUpdateClientConfiguration(api: ListeningApi) {
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, body }: { orgId: string; body: ListeningConfigurationUpdateRequest }) =>
      withStepUp(stepUp, () => api.updateOpsConfiguration(orgId, body)),
    onSuccess: (data, { orgId }) => queryClient.setQueryData(listeningOpsKeys.configuration(orgId), data),
    onSettled: (_data, error, { orgId }) =>
      error instanceof StepUpCancelledError
        ? undefined
        : queryClient.invalidateQueries({ queryKey: listeningOpsKeys.configuration(orgId) }),
  });
}
