/**
 * TanStack Query hooks over the coordinator routes
 * (`/ops/workplace-reviews/*`, operations context,
 * `workplace_reviews.coordinate`) and the reviewer routes
 * (`/expert/workplace-reviews/*`, expert context). None of these actions is a
 * step-up class (only the employer's `workplace_reviews.scope.accept` is), so
 * the calls go straight through. `useExpertContext` mirrors
 * `useOperationsContext`: the reviewer's screens switch the session into the
 * expert context once and stay disabled until it is there.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeningKeys } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import type {
  ActiveContext,
  ImprovementActionCreateRequest,
  ReviewAssignRequest,
  ReviewCancelRequest,
  ReviewFollowUpRequest,
  ReviewNoteRequest,
  ReviewReportDraftRequest,
  ReviewScopeCreateRequest,
  ReviewTriageRequest,
  ReviewWindowsRequest,
} from '@nestself/contracts';
import { useAuth } from '../../auth';
import { listeningErrorKey } from '../listening/listening-errors';
import type { ListeningErrorKey } from '../listening/listening-errors';

export { useOperationsContext } from '../access/use-ops-admin';

function useCtx(): ActiveContext {
  const { principal } = useAuth();
  return principal?.context ?? { kind: 'personal' };
}

const pendingSwitches = new WeakMap<object, Promise<void>>();

/**
 * The reviewer's routes need the expert context. When the session is in
 * another one, this switches once (never again on re-render) and reports a
 * failed switch; `ready` is true once the principal is in that context.
 */
export function useExpertContext(sampleMode: boolean): { ready: boolean; error: ListeningErrorKey | null } {
  const { principal, switchContext } = useAuth();
  const inExpert = principal?.context.kind === 'expert';
  const switchRequested = useRef(false);
  const [error, setError] = useState<ListeningErrorKey | null>(null);

  useEffect(() => {
    if (inExpert) switchRequested.current = true;
    if (sampleMode || !principal || inExpert || switchRequested.current) return;
    switchRequested.current = true;
    let pending = pendingSwitches.get(switchContext);
    if (!pending) {
      pending = switchContext({ kind: 'expert' }).finally(() => pendingSwitches.delete(switchContext));
      pendingSwitches.set(switchContext, pending);
    }
    pending.catch((err: unknown) => setError(listeningErrorKey(err) ?? 'unknown'));
  }, [sampleMode, principal, inExpert, switchContext]);

  return { ready: !sampleMode && inExpert, error: sampleMode ? null : error };
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export function useOpsReviewServices(api: ListeningApi, enabled: boolean) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.opsReviewServices(ctx), queryFn: () => api.opsReviewServices(), enabled });
}

export function useReviewQueue(api: ListeningApi, enabled: boolean) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.reviewQueue(ctx), queryFn: () => api.reviewQueue(), enabled });
}

export function useOpsReviewRequest(api: ListeningApi, id: string | null) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.opsReviewRequest(ctx, id ?? ''), queryFn: () => api.opsReviewRequest(id!), enabled: id !== null });
}

function useInvalidateRequest(id: string) {
  const ctx = useCtx();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listeningKeys.opsReviewRequest(ctx, id) }),
      queryClient.invalidateQueries({ queryKey: listeningKeys.reviewQueue(ctx) }),
    ]);
}

export function useTriage(api: ListeningApi, id: string) {
  const invalidate = useInvalidateRequest(id);
  return useMutation({ mutationFn: (body: ReviewTriageRequest) => api.triageReviewRequest(id, body), onSettled: () => invalidate() });
}

export function useSendScope(api: ListeningApi, id: string) {
  const invalidate = useInvalidateRequest(id);
  return useMutation({ mutationFn: (body: ReviewScopeCreateRequest) => api.sendReviewScope(id, body), onSettled: () => invalidate() });
}

export function useReviewerCandidates(api: ListeningApi, q: string, enabled: boolean) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.reviewerCandidates(ctx, q), queryFn: () => api.reviewerCandidates(q || undefined), enabled });
}

export function useOpsEngagement(api: ListeningApi, id: string | null) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.opsEngagement(ctx, id ?? ''), queryFn: () => api.opsEngagement(id!), enabled: id !== null });
}

function useInvalidateOpsEngagement(id: string, requestId: string | null) {
  const ctx = useCtx();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listeningKeys.opsEngagement(ctx, id) }),
      queryClient.invalidateQueries({ queryKey: listeningKeys.reviewQueue(ctx) }),
      ...(requestId ? [queryClient.invalidateQueries({ queryKey: listeningKeys.opsReviewRequest(ctx, requestId) })] : []),
    ]);
}

export function useAssignReviewer(api: ListeningApi, id: string, requestId: string | null) {
  const invalidate = useInvalidateOpsEngagement(id, requestId);
  return useMutation({ mutationFn: (body: ReviewAssignRequest) => api.assignReviewer(id, body), onSettled: () => invalidate() });
}

export function useProposeWindows(api: ListeningApi, id: string, requestId: string | null) {
  const invalidate = useInvalidateOpsEngagement(id, requestId);
  return useMutation({ mutationFn: (body: ReviewWindowsRequest) => api.proposeWindows(id, body), onSettled: () => invalidate() });
}

export function useOpsCancelEngagement(api: ListeningApi, id: string, requestId: string | null) {
  const invalidate = useInvalidateOpsEngagement(id, requestId);
  return useMutation({ mutationFn: (body: ReviewCancelRequest) => api.opsCancelEngagement(id, body), onSettled: () => invalidate() });
}

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

export function useMyEngagements(api: ListeningApi, enabled: boolean) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.myEngagements(ctx), queryFn: () => api.myEngagements(), enabled });
}

export function useMyEngagement(api: ListeningApi, id: string | null) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.myEngagement(ctx, id ?? ''), queryFn: () => api.myEngagement(id!), enabled: id !== null });
}

/** The shared pack; a 409 `sharing_revoked` or a 404 is a state, not a failure to retry. */
export function useEngagementPack(api: ListeningApi, id: string | null) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.engagementPack(ctx, id ?? ''), queryFn: () => api.engagementPack(id!), enabled: id !== null, retry: false });
}

/** The current report version; a 404 means none was saved yet. */
export function useMyReport(api: ListeningApi, id: string | null) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.myReport(ctx, id ?? ''), queryFn: () => api.myReport(id!), enabled: id !== null, retry: false });
}

export function useEngagementNotes(api: ListeningApi, id: string | null) {
  const ctx = useCtx();
  return useQuery({ queryKey: listeningKeys.engagementNotes(ctx, id ?? ''), queryFn: () => api.engagementNotes(id!), enabled: id !== null });
}

export const myActionsKey = (ctx: ActiveContext, id: string) => [...listeningKeys.myEngagement(ctx, id), 'actions'] as const;

export function useMyActions(api: ListeningApi, id: string | null) {
  const ctx = useCtx();
  return useQuery({ queryKey: myActionsKey(ctx, id ?? ''), queryFn: () => api.myEngagementActions(id!), enabled: id !== null });
}

function useInvalidateMine(id: string) {
  const ctx = useCtx();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listeningKeys.myEngagement(ctx, id) }),
      queryClient.invalidateQueries({ queryKey: listeningKeys.myEngagements(ctx) }),
      queryClient.invalidateQueries({ queryKey: listeningKeys.myReport(ctx, id) }),
    ]);
}

export function useSaveReport(api: ListeningApi, id: string) {
  const invalidate = useInvalidateMine(id);
  return useMutation({ mutationFn: (body: ReviewReportDraftRequest) => api.saveReport(id, body), onSettled: () => invalidate() });
}

export function useSubmitReportReview(api: ListeningApi, id: string) {
  const invalidate = useInvalidateMine(id);
  return useMutation({ mutationFn: () => api.submitReportReview(id), onSettled: () => invalidate() });
}

export function useShareReport(api: ListeningApi, id: string) {
  const invalidate = useInvalidateMine(id);
  return useMutation({ mutationFn: () => api.shareReport(id), onSettled: () => invalidate() });
}

export function useAddNote(api: ListeningApi, id: string) {
  const ctx = useCtx();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewNoteRequest) => api.addEngagementNote(id, body),
    onSuccess: (data) => queryClient.setQueryData(listeningKeys.engagementNotes(ctx, id), data),
  });
}

export function useProposeAction(api: ListeningApi, id: string) {
  const ctx = useCtx();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImprovementActionCreateRequest) => api.proposeAction(id, body),
    onSuccess: (data) => queryClient.setQueryData(myActionsKey(ctx, id), data),
  });
}

export function usePlanFollowUp(api: ListeningApi, id: string) {
  const invalidate = useInvalidateMine(id);
  return useMutation({ mutationFn: (body: ReviewFollowUpRequest) => api.planFollowUp(id, body), onSettled: () => invalidate() });
}

export function useCompleteEngagement(api: ListeningApi, id: string) {
  const invalidate = useInvalidateMine(id);
  return useMutation({ mutationFn: () => api.completeEngagement(id), onSettled: () => invalidate() });
}
