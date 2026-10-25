/**
 * Webinar reads for the admin routes: the API in API mode, the sample
 * fixtures in sample mode (CW-R-56), in the same shapes.
 *
 * There is no `GET /ops/webinars/:id` (T-CW-2.1 serves the list, the form
 * routes and the attendance): the detail finds the occurrence in the
 * operations list, page by page.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError, webinarAttendanceQuery, webinarDetailQuery, webinarKeys, webinarOpsListQuery } from '@nestself/api-client';
import { WEBINAR_LIST_MAX_LIMIT } from '@nestself/contracts';
import type { Webinar, WebinarAttendanceResponse, WebinarResponse } from '@nestself/contracts';
import { isSampleDataMode } from '../data-source';
import { sampleHostView, sampleOccurrence, sampleOccurrences } from './sample';
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

export function useOccurrenceList(): OccurrenceListState {
  const query = useInfiniteQuery({ ...webinarOpsListQuery(webinarsApi), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    return {
      status: 'success',
      items: sampleOccurrences(),
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

/** One occurrence from the operations list; 404 when no page holds it. */
async function findOccurrence(webinarId: string): Promise<Webinar> {
  let cursor: string | undefined;
  do {
    const page = await webinarsApi.listOps({ cursor, limit: WEBINAR_LIST_MAX_LIMIT });
    const found = page.items.find((item) => item.id === webinarId);
    if (found) return found;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  throw new ApiError({ status: 404, code: 'not_found', message: 'Webinar not found', requestId: null });
}

export interface OccurrenceState {
  status: 'pending' | 'error' | 'success';
  webinar: Webinar | null;
  error: unknown;
  refetch: () => void;
}

export function useOccurrence(webinarId: string): OccurrenceState {
  const query = useQuery({
    queryKey: [...webinarKeys.ops(), 'occurrence', webinarId],
    queryFn: () => findOccurrence(webinarId),
    enabled: !isSampleDataMode,
    retry: false,
  });
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
  if (isSampleDataMode || !enabled) return { status: 'success', attendance: null, error: null };
  return { status: query.status, attendance: query.data ?? null, error: query.error };
}
