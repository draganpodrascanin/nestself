/**
 * Webinar reads for the workspace routes: the API in API mode, the sample
 * fixtures in sample mode (CW-R-56). Both return the same shape, so the
 * screens do not branch on the data source. The list is whatever the server
 * answers: eligibility is never filtered on the client (WBN-01).
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { webinarDetailQuery, webinarListQuery } from '@nestself/api-client';
import type { WebinarResponse } from '@nestself/contracts';
import { isSampleDataMode } from '../data-source';
import { sampleWebinar, sampleWebinarList } from './sample';
import { webinarsApi } from './webinars-api';

export interface WebinarListState {
  status: 'pending' | 'error' | 'success';
  items: WebinarResponse[];
  error: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
}

export function useWebinarList(): WebinarListState {
  const query = useInfiniteQuery({ ...webinarListQuery(webinarsApi), enabled: !isSampleDataMode });
  if (isSampleDataMode) {
    return {
      status: 'success',
      items: sampleWebinarList(),
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

export interface WebinarState {
  status: 'pending' | 'error' | 'success';
  webinar: WebinarResponse | null;
  error: unknown;
  refetch: () => void;
}

export function useWebinar(webinarId: string): WebinarState {
  const query = useQuery({ ...webinarDetailQuery(webinarsApi, webinarId), enabled: !isSampleDataMode });
  if (isSampleDataMode) return { status: 'success', webinar: sampleWebinar(webinarId), error: null, refetch: () => undefined };
  return { status: query.status, webinar: query.data ?? null, error: query.error, refetch: () => void query.refetch() };
}
