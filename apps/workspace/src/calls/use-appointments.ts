/**
 * Appointment reads for the workspace routes: the API in API mode, the
 * sample fixtures in sample mode (CW-R-56). Both return the same shape so
 * the screens do not branch on the data source.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { appointmentDetailQuery, appointmentListQuery } from '@nestself/api-client';
import type { AppointmentListParams, AppointmentView } from '@nestself/api-client';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { sampleAppointment, sampleAppointmentsFor } from './sample';

export interface AppointmentListState {
  status: 'pending' | 'error' | 'success';
  items: AppointmentView[];
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}

/**
 * One cursor-paged list: `from` and `to` bound `startsAt` (inclusive and
 * exclusive), `order` is `asc` (what is ahead) or `desc` (history, newest
 * first). Sample mode applies the same bounds and order to the fixtures.
 */
export function useAppointmentList(params: Pick<AppointmentListParams, 'from' | 'to' | 'order'> = {}): AppointmentListState {
  const { principal } = useAuth();
  const query = useInfiniteQuery({ ...appointmentListQuery(callsApi, params), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    const from = params.from ? Date.parse(params.from) : null;
    const to = params.to ? Date.parse(params.to) : null;
    const direction = params.order === 'desc' ? -1 : 1;
    return {
      status: 'success',
      items: sampleAppointmentsFor(principal?.userId)
        .filter((item) => (from === null || Date.parse(item.startsAt) >= from) && (to === null || Date.parse(item.startsAt) < to))
        .sort((a, b) => direction * (Date.parse(a.startsAt) - Date.parse(b.startsAt))),
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

export interface AppointmentState {
  status: 'pending' | 'error' | 'success';
  appointment: AppointmentView | null;
  error: unknown;
  refetch: () => void;
}

export function useAppointment(appointmentId: string): AppointmentState {
  const { principal } = useAuth();
  const query = useQuery({ ...appointmentDetailQuery(callsApi, appointmentId), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    const appointment = sampleAppointment(appointmentId, principal?.userId);
    return { status: 'success', appointment, error: null, refetch: () => undefined };
  }
  return { status: query.status, appointment: query.data ?? null, error: query.error, refetch: () => void query.refetch() };
}
