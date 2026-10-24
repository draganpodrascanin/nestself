/**
 * Appointment reads for the workspace routes: the API in API mode, the
 * sample fixtures in sample mode (CW-R-56). Both return the same shape so
 * the screens do not branch on the data source.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { appointmentDetailQuery, appointmentListQuery } from '@nestself/api-client';
import type { AppointmentResponse } from '@nestself/contracts';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { sampleAppointment, sampleAppointmentsFor } from './sample';

export interface AppointmentListState {
  status: 'pending' | 'error' | 'success';
  items: AppointmentResponse[];
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}

export function useAppointmentList(): AppointmentListState {
  const { principal } = useAuth();
  const query = useInfiniteQuery({ ...appointmentListQuery(callsApi), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    return {
      status: 'success',
      items: sampleAppointmentsFor(principal?.userId),
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
  appointment: AppointmentResponse | null;
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
