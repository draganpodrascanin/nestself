/**
 * TanStack Query hooks over the feedback case routes of the listening API.
 * Keys start with the active context so a context switch clears them. The
 * handler routes (`feedback_case.handle`, `feedback_case.assign`) are
 * restricted step-up actions and the server checks the step-up on the reads
 * too, so every handler call goes through `withStepUp`; a cancelled step-up
 * refreshes nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeningKeys } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import type {
  FeedbackCaseCreateRequest,
  FeedbackMessageRequest,
  FeedbackReassignRequest,
  FeedbackReporterMessageRequest,
  FeedbackRoutesUpdateRequest,
  FeedbackStateRequest,
} from '@nestself/contracts';
import { StepUpCancelledError, useAuth, withStepUp } from '../../auth';

function useContextOrPersonal() {
  const { principal } = useAuth();
  return principal?.context ?? { kind: 'personal' as const };
}

// ── Employee ────────────────────────────────────────────────────────────────

export function useFeedbackRoutes(api: ListeningApi, enabled: boolean) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.feedbackRoutes(ctx), queryFn: () => api.feedbackRoutes(), enabled });
}

export function useCreateFeedbackCase(api: ListeningApi) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: FeedbackCaseCreateRequest; idempotencyKey: string }) => api.createFeedbackCase(body, idempotencyKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listeningKeys.myFeedbackCases(ctx) }),
  });
}

export function useMyFeedbackCases(api: ListeningApi, enabled: boolean) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.myFeedbackCases(ctx), queryFn: () => api.myFeedbackCases(), enabled });
}

export function useMyFeedbackCase(api: ListeningApi, id: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.myFeedbackCase(ctx, id ?? ''), queryFn: () => api.myFeedbackCase(id!), enabled: id !== null });
}

export function useReplyToMyCase(api: ListeningApi, id: string) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: FeedbackReporterMessageRequest; idempotencyKey: string }) => api.replyToMyCase(id, body, idempotencyKey),
    onSuccess: (data) => {
      queryClient.setQueryData(listeningKeys.myFeedbackCase(ctx, id), data);
      void queryClient.invalidateQueries({ queryKey: listeningKeys.myFeedbackCases(ctx) });
    },
  });
}

// ── Handler ─────────────────────────────────────────────────────────────────

export function useFeedbackInbox(api: ListeningApi, enabled: boolean) {
  const ctx = useContextOrPersonal();
  const { stepUp } = useAuth();
  return useQuery({
    queryKey: listeningKeys.feedbackInbox(ctx),
    queryFn: () => withStepUp(stepUp, () => api.feedbackInbox()),
    enabled,
    refetchOnWindowFocus: (query) => !(query.state.error instanceof StepUpCancelledError),
  });
}

export function useHandlerCase(api: ListeningApi, id: string | null) {
  const ctx = useContextOrPersonal();
  const { stepUp } = useAuth();
  return useQuery({
    queryKey: listeningKeys.handlerCase(ctx, id ?? ''),
    queryFn: () => withStepUp(stepUp, () => api.handlerCase(id!)),
    enabled: id !== null,
    refetchOnWindowFocus: (query) => !(query.state.error instanceof StepUpCancelledError),
  });
}

function useHandlerMutation<TVars>(id: string, call: (vars: TVars) => Promise<Awaited<ReturnType<ListeningApi['handlerCase']>>>) {
  const ctx = useContextOrPersonal();
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => withStepUp(stepUp, () => call(vars)),
    onSuccess: (data) => queryClient.setQueryData(listeningKeys.handlerCase(ctx, id), data),
    onSettled: (_data, error) =>
      error instanceof StepUpCancelledError ? undefined : queryClient.invalidateQueries({ queryKey: listeningKeys.feedbackInbox(ctx) }),
  });
}

export function useHandlerMessage(api: ListeningApi, id: string) {
  return useHandlerMutation(id, ({ body, idempotencyKey }: { body: FeedbackMessageRequest; idempotencyKey: string }) => api.handlerMessage(id, body, idempotencyKey));
}

export function useSetCaseState(api: ListeningApi, id: string) {
  return useHandlerMutation(id, (body: FeedbackStateRequest) => api.setCaseState(id, body));
}

export function useReassignCase(api: ListeningApi, id: string) {
  return useHandlerMutation(id, (body: FeedbackReassignRequest) => api.reassignCase(id, body));
}

// ── Organization settings ───────────────────────────────────────────────────

export function useOrgFeedbackRoutes(api: ListeningApi, orgId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.orgFeedbackRoutes(ctx, orgId ?? ''), queryFn: () => api.orgFeedbackRoutes(orgId!), enabled: orgId !== null });
}

export function useUpdateOrgFeedbackRoutes(api: ListeningApi, orgId: string) {
  const ctx = useContextOrPersonal();
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: FeedbackRoutesUpdateRequest) => withStepUp(stepUp, () => api.updateOrgFeedbackRoutes(orgId, body)),
    onSuccess: (data) => queryClient.setQueryData(listeningKeys.orgFeedbackRoutes(ctx, orgId), data),
  });
}
