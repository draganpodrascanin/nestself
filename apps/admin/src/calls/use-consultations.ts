/**
 * Consultation reads for the admin routes: the API in API mode, the sample
 * fixtures in sample mode. `GET /appointments` answers by the caller's
 * context: the expert's own consultations, or the coordinated organisations'
 * for operations (CALL-18, CALL-28).
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { appointmentDetailQuery, appointmentListQuery } from '@nestself/api-client';
import type { Appointment } from '@nestself/contracts';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { isConsultingExpert } from './route-gate';
import { sampleConsultation, sampleConsultationsFor } from './sample';

export interface ConsultationListState {
  status: 'pending' | 'error' | 'success';
  items: Appointment[];
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}

export function useConsultationList(): ConsultationListState {
  const { principal, effectiveActions } = useAuth();
  const query = useInfiniteQuery({ ...appointmentListQuery(callsApi), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    const items = sampleConsultationsFor(principal?.userId, !isConsultingExpert(principal, effectiveActions));
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
  appointment: Appointment | null;
  error: unknown;
  refetch: () => void;
}

export function useConsultation(appointmentId: string): ConsultationState {
  const { principal } = useAuth();
  const query = useQuery({ ...appointmentDetailQuery(callsApi, appointmentId), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    return { status: 'success', appointment: sampleConsultation(appointmentId, principal?.userId), error: null, refetch: () => undefined };
  }
  return { status: query.status, appointment: query.data ?? null, error: query.error, refetch: () => void query.refetch() };
}
