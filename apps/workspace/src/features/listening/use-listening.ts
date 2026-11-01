/**
 * TanStack Query hooks over the listening API. Keys start with the active
 * context so a context switch clears them. Passing `orgId: null` disables an
 * employer query (sample mode, or before the organization context is in
 * place). Mutations that the server may answer with `step_up_required` go
 * through `withStepUp`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeningKeys } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import type {
  ListeningDimensionKey,
  OfferDismissRequest,
  SurveyCycleScheduleRequest,
  SurveyDraftRequest,
  SurveySubmitRequest,
} from '@nestself/contracts';
import { useAuth, withStepUp } from '../../auth';

function useContextOrPersonal() {
  const { principal } = useAuth();
  return principal?.context ?? { kind: 'personal' as const };
}

export function useMySurvey(listeningApi: ListeningApi, enabled: boolean) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.mySurvey(ctx), queryFn: () => listeningApi.mySurvey(), enabled });
}

export function useSaveDraft(listeningApi: ListeningApi, cycleId: string) {
  return useMutation({ mutationFn: (body: SurveyDraftRequest) => listeningApi.saveDraft(cycleId, body) });
}

export function useSubmitSurvey(listeningApi: ListeningApi, cycleId: string) {
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: SurveySubmitRequest; idempotencyKey: string }) =>
      listeningApi.submitSurvey(cycleId, body, idempotencyKey),
    onSettled: () => queryClient.invalidateQueries({ queryKey: listeningKeys.mySurvey(ctx) }),
  });
}

export function useOverview(listeningApi: ListeningApi, orgId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.overview(ctx, orgId ?? ''), queryFn: () => listeningApi.overview(orgId!), enabled: orgId !== null });
}

export function useHeatmap(listeningApi: ListeningApi, orgId: string | null, snapshotId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({
    queryKey: listeningKeys.heatmap(ctx, orgId ?? '', snapshotId),
    queryFn: () => listeningApi.heatmap(orgId!, snapshotId ?? undefined),
    enabled: orgId !== null,
  });
}

export function useDimension(listeningApi: ListeningApi, orgId: string | null, key: ListeningDimensionKey, snapshotId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({
    queryKey: listeningKeys.dimension(ctx, orgId ?? '', key, snapshotId),
    queryFn: () => listeningApi.dimension(orgId!, key, snapshotId ?? undefined),
    enabled: orgId !== null,
  });
}

export function useCycles(listeningApi: ListeningApi, orgId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({ queryKey: listeningKeys.cycles(ctx, orgId ?? ''), queryFn: () => listeningApi.listCycles(orgId!), enabled: orgId !== null });
}

export function useListeningConfiguration(listeningApi: ListeningApi, orgId: string | null) {
  const ctx = useContextOrPersonal();
  return useQuery({
    queryKey: listeningKeys.configuration(ctx, orgId ?? ''),
    queryFn: () => listeningApi.configuration(orgId!),
    enabled: orgId !== null,
  });
}

function useOrgMutation<TBody, TResult>(call: (body: TBody) => Promise<TResult>, orgId: string) {
  const { stepUp } = useAuth();
  const ctx = useContextOrPersonal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => withStepUp(stepUp, () => call(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...listeningKeys.all(ctx), orgId] }),
  });
}

export function useScheduleCycle(listeningApi: ListeningApi, orgId: string) {
  return useOrgMutation((body: SurveyCycleScheduleRequest) => listeningApi.scheduleCycle(orgId, body), orgId);
}

export function useCancelCycle(listeningApi: ListeningApi, orgId: string) {
  return useOrgMutation((cycleId: string) => listeningApi.cancelCycle(orgId, cycleId), orgId);
}

export function useDismissOffer(listeningApi: ListeningApi, orgId: string) {
  return useOrgMutation((body: OfferDismissRequest) => listeningApi.dismissOffer(orgId, body), orgId);
}

/** Downloads the CSV through the browser: a blob and a temporary anchor, after a step-up when the server asks for one. */
export function useExportCsv(listeningApi: ListeningApi, orgId: string) {
  const { stepUp } = useAuth();
  return useMutation({
    mutationFn: async (snapshotId: string) => {
      const file = await withStepUp(stepUp, () => listeningApi.exportCsv(orgId, snapshotId));
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8' }));
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      return file.filename;
    },
  });
}
