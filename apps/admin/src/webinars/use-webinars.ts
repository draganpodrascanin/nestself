/**
 * Webinar reads for the admin routes: the API in API mode, the sample
 * fixtures in sample mode (CW-R-56), in the same shapes.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { webinarAttendanceQuery, webinarDetailQuery, webinarKeys, webinarOpsDetailQuery, webinarOpsListQuery } from '@nestself/api-client';
import type { RecordingStatus, Webinar, WebinarAttendanceResponse, WebinarResponse } from '@nestself/contracts';
import { isSampleDataMode } from '../data-source';
import { useAuth } from '../auth';
import { sampleAttendance, sampleHostView, sampleOccurrence, sampleOccurrences, sampleRecordingStatus } from './sample';
import { webinarsApi } from './webinars-api';

export interface OccurrenceListState {
  status: 'pending' | 'error' | 'success';
  items: Webinar[];
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}

/** `GET /ops/webinars`; with `mine`, the occurrences the caller hosts (a presenter's list). */
export function useOccurrenceList(mine = false): OccurrenceListState {
  const { principal } = useAuth();
  const query = useInfiniteQuery({ ...webinarOpsListQuery(webinarsApi, mine ? { mine } : {}), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    const all = sampleOccurrences();
    return {
      status: 'success',
      items: mine ? all.filter((webinar) => webinar.hosts.some((host) => host.userId === principal?.userId)) : all,
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

export interface OccurrenceState {
  status: 'pending' | 'error' | 'success';
  webinar: Webinar | null;
  error: unknown;
  refetch: () => void;
}

export function useOccurrence(webinarId: string): OccurrenceState {
  const query = useQuery({ ...webinarOpsDetailQuery(webinarsApi, webinarId), enabled: !isSampleDataMode });
  if (isSampleDataMode) return { status: 'success', webinar: sampleOccurrence(webinarId), error: null, refetch: () => undefined };
  return { status: query.status, webinar: query.data ?? null, error: query.error, refetch: () => void query.refetch() };
}

export interface HostViewState {
  status: 'pending' | 'error' | 'success';
  webinar: WebinarResponse | null;
  error: unknown;
  refetch: () => void;
}

/** `GET /webinars/:id`, which serves the occurrence's hosts and moderating staff. */
export function useHostView(webinarId: string): HostViewState {
  const query = useQuery({ ...webinarDetailQuery(webinarsApi, webinarId), enabled: !isSampleDataMode });
  if (isSampleDataMode) return { status: 'success', webinar: sampleHostView(webinarId), error: null, refetch: () => undefined };
  return { status: query.status, webinar: query.data ?? null, error: query.error, refetch: () => void query.refetch() };
}

export interface AttendanceState {
  status: 'pending' | 'error' | 'success';
  attendance: WebinarAttendanceResponse | null;
  error: unknown;
}

/** `GET /ops/webinars/:id/attendance` once the webinar ran (WBN-33): counts only, never names. */
export function useAttendance(webinarId: string, enabled: boolean): AttendanceState {
  const query = useQuery({ ...webinarAttendanceQuery(webinarsApi, webinarId), enabled: enabled && !isSampleDataMode });
  if (!enabled) return { status: 'success', attendance: null, error: null };
  if (isSampleDataMode) return { status: 'success', attendance: sampleAttendance(webinarId), error: null };
  return { status: query.status, attendance: query.data ?? null, error: query.error };
}

export interface RecordingState {
  status: 'pending' | 'error' | 'success';
  recording: RecordingStatus | null;
  error: unknown;
}

/** `GET /webinars/:id/recording` for a live or ended occurrence (WBN-34). */
export function useRecordingState(webinar: Webinar, enabled: boolean): RecordingState {
  const query = useQuery({
    queryKey: [...webinarKeys.detail(webinar.id), 'recording'],
    queryFn: () => webinarsApi.recording(webinar.id),
    enabled: enabled && !isSampleDataMode,
    retry: false,
  });
  if (!enabled) return { status: 'success', recording: null, error: null };
  if (isSampleDataMode) return { status: 'success', recording: sampleRecordingStatus(webinar), error: null };
  return { status: query.status, recording: query.data?.status ?? null, error: query.error };
}
