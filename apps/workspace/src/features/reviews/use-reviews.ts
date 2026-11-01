/**
 * TanStack Query hooks over the workplace review routes of the listening API
 * (organization side). Keys start with the active context so a context switch
 * clears them. Accepting a scope is a financial step-up action and goes
 * through `withStepUp`; the other mutations invalidate the request and
 * engagement caches.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeningKeys } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import type {
  ImprovementActionCreateRequest,
  ImprovementActionUpdateRequest,
  ReviewBookRequest,
  ReviewCancelRequest,
  ReviewInformationRequest,
  ReviewRequestCreateRequest,
  ReviewSharingGrantRequest,
} from '@nestself/contracts';
import { useAuth, withStepUp } from '../../auth';

function useContextOrPersonal() {
  const { principal } = useAuth();
  return principal?.context ?? { kind: 'personal' as const };
}

export function useReviewServices(api: ListeningApi, orgId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.reviewServices(ctx, orgId ?? ''), queryFn: () => api.reviewServices(orgId!), enabled: orgId !== null });
}

export function useReviewRequests(api: ListeningApi, orgId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.reviewRequests(ctx, orgId ?? ''), queryFn: () => api.listReviewRequests(orgId!), enabled: orgId !== null });
}

export function useReviewRequest(api: ListeningApi, orgId: string | null, id: string) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.reviewRequest(ctx, orgId ?? '', id), queryFn: () => api.reviewRequest(orgId!, id), enabled: orgId !== null });
}

export function useEngagements(api: ListeningApi, orgId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.engagements(ctx, orgId ?? ''), queryFn: () => api.listEngagements(orgId!), enabled: orgId !== null });
}

export function useEngagement(api: ListeningApi, orgId: string | null, id: string) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.engagement(ctx, orgId ?? '', id), queryFn: () => api.engagement(orgId!, id), enabled: orgId !== null });
}

export function useEngagementReport(api: ListeningApi, orgId: string | null, id: string, enabled: boolean) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.engagementReport(ctx, orgId ?? '', id), queryFn: () => api.engagementReport(orgId!, id), enabled: orgId !== null && enabled, retry: false });
}

function useInvalidateReviews(orgId: string) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listeningKeys.reviewRequests(ctx, orgId) }),
      queryClient.invalidateQueries({ queryKey: listeningKeys.engagements(ctx, orgId) }),
      queryClient.invalidateQueries({ queryKey: listeningKeys.overview(ctx, orgId) }),
    ]);
}

export function useCreateReviewRequest(api: ListeningApi, orgId: string) {
  const invalidate = useInvalidateReviews(orgId);
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: ReviewRequestCreateRequest; idempotencyKey: string }) => api.createReviewRequest(orgId, body, idempotencyKey),
    onSuccess: () => invalidate(),
  });
}

export function useCancelReviewRequest(api: ListeningApi, orgId: string, id: string) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReviews(orgId);
  return useMutation({
    mutationFn: (body: ReviewCancelRequest) => api.cancelReviewRequest(orgId, id, body),
    onSuccess: (data) => {
      queryClient.setQueryData(listeningKeys.reviewRequest(ctx, orgId, id), data);
      void invalidate();
    },
  });
}

export function useAnswerInformation(api: ListeningApi, orgId: string, id: string) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewInformationRequest) => api.answerReviewInformation(orgId, id, body),
    onSuccess: (data) => queryClient.setQueryData(listeningKeys.reviewRequest(ctx, orgId, id), data),
  });
}

/** Accepting binds the scope and creates the engagement: a financial step-up action. */
export function useAcceptScope(api: ListeningApi, orgId: string, requestId: string) {
  const ctx = useContextOrPersonal();
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReviews(orgId);
  return useMutation({
    mutationFn: (scopeId: string) => withStepUp(stepUp, () => api.acceptReviewScope(orgId, scopeId)),
    onSuccess: (data) => {
      queryClient.setQueryData(listeningKeys.engagement(ctx, orgId, data.id), data);
      void queryClient.invalidateQueries({ queryKey: listeningKeys.reviewRequest(ctx, orgId, requestId) });
      void invalidate();
    },
  });
}

export function useRejectScope(api: ListeningApi, orgId: string, requestId: string) {
  const ctx = useContextOrPersonal();
  const { stepUp } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scopeId: string) => withStepUp(stepUp, () => api.rejectReviewScope(orgId, scopeId)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listeningKeys.reviewRequest(ctx, orgId, requestId) }),
  });
}

function useEngagementMutation<TVars>(api: ListeningApi, orgId: string, id: string, call: (vars: TVars) => ReturnType<ListeningApi['engagement']>) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReviews(orgId);
  return useMutation({
    mutationFn: (vars: TVars) => call(vars),
    onSuccess: (data) => {
      queryClient.setQueryData(listeningKeys.engagement(ctx, orgId, id), data);
      void invalidate();
    },
  });
}

export function useBookEngagement(api: ListeningApi, orgId: string, id: string) {
  return useEngagementMutation(api, orgId, id, (body: ReviewBookRequest) => api.bookEngagement(orgId, id, body));
}

export function useCancelEngagement(api: ListeningApi, orgId: string, id: string) {
  return useEngagementMutation(api, orgId, id, (body: ReviewCancelRequest) => api.cancelEngagement(orgId, id, body));
}

export function useShareWithReviewer(api: ListeningApi, orgId: string, id: string) {
  return useEngagementMutation(api, orgId, id, (body: ReviewSharingGrantRequest) => api.shareWithReviewer(orgId, id, body));
}

export function useRevokeSharing(api: ListeningApi, orgId: string, id: string) {
  return useEngagementMutation(api, orgId, id, (grantId: string) => api.revokeSharing(orgId, id, grantId));
}

export function useCreateAction(api: ListeningApi, orgId: string, id: string) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImprovementActionCreateRequest) => api.createEngagementAction(orgId, id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listeningKeys.engagement(ctx, orgId, id) }),
  });
}

export function useUpdateAction(api: ListeningApi, orgId: string, id: string) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, body }: { actionId: string; body: ImprovementActionUpdateRequest }) => api.updateEngagementAction(orgId, id, actionId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listeningKeys.engagement(ctx, orgId, id) }),
  });
}
