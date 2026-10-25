/**
 * Consultation reads for the admin routes: the API in API mode, the sample
 * fixtures in sample mode. `GET /appointments` answers by the caller's
 * context: the expert's own consultations, or the coordinated organisations'
 * for operations, filtered by organisation, status and dates (CALL-18,
 * CALL-28).
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { appointmentDetailQuery, appointmentKeys, appointmentListQuery } from '@nestself/api-client';
import type { AppointmentListParams, AppointmentView } from '@nestself/api-client';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { isConsultingExpert } from './route-gate';
import { sampleConsultation, sampleConsultationsFor } from './sample';

export type ConsultationListParams = Omit<AppointmentListParams, 'cursor'>;

export interface ConsultationListState {
  status: 'pending' | 'error' | 'success';
  items: AppointmentView[];
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}

function matches(item: AppointmentView, params: ConsultationListParams): boolean {
  const starts = Date.parse(item.startsAt);
  return (
    (!params.orgId || item.orgId === params.orgId) &&
    (!params.status || item.status === params.status) &&
    (!params.from || starts >= Date.parse(params.from)) &&
    (!params.to || starts < Date.parse(params.to))
  );
}

export function useConsultationList(params: ConsultationListParams = {}): ConsultationListState {
  const { principal, effectiveActions } = useAuth();
  const query = useInfiniteQuery({ ...appointmentListQuery(callsApi, params), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    const items = sampleConsultationsFor(principal?.userId, !isConsultingExpert(principal, effectiveActions)).filter((item) => matches(item, params));
    return {
      status: 'success',
      items: items.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: () => undefined,
      refetch: () => undefined,
    };
  }
  return {
    status: query.status,
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    error: query.error,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: () => void query.fetchNextPage(),
    refetch: () => void query.refetch(),
  };
}

export interface ConsultationState {
  status: 'pending' | 'error' | 'success';
  appointment: AppointmentView | null;
  error: unknown;
  refetch: () => void;
}

type ListPages = InfiniteData<{ items: AppointmentView[] }>;

/**
 * One consultation. Operations cannot read `GET /appointments/:id` (it needs
 * `consultation.join`), so their read-only view uses the row the list
 * already loaded and only asks the API when no list holds it.
 */
export function useConsultation(appointmentId: string, options: { fromListOnly?: boolean } = {}): ConsultationState {
  const { principal, effectiveActions } = useAuth();
  const queryClient = useQueryClient();
  const fromList = options.fromListOnly
    ? queryClient
        .getQueriesData<ListPages>({ queryKey: appointmentKeys.lists() })
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.items) ?? [])
        .find((item) => item.id === appointmentId)
    : undefined;
  const query = useQuery({ ...appointmentDetailQuery(callsApi, appointmentId), enabled: !isSampleDataMode && !fromList });
  if (isSampleDataMode) {
    const operations = !isConsultingExpert(principal, effectiveActions);
    return { status: 'success', appointment: sampleConsultation(appointmentId, principal?.userId, operations), error: null, refetch: () => undefined };
  }
  if (fromList) return { status: 'success', appointment: fromList, error: null, refetch: () => undefined };
  return { status: query.status, appointment: query.data ?? null, error: query.error, refetch: () => void query.refetch() };
}
