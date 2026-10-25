/**
 * TanStack Query options for the webinar routes (T-CW-2.4). There is no
 * option for `join`: its response holds meeting credentials, and a query or
 * mutation would keep them in a cache (CW-R-59).
 */
import { infiniteQueryOptions, mutationOptions, queryOptions } from '@tanstack/react-query';
import type { WebinarUpdateRequest } from '@nestself/contracts';
import type { WebinarCreateBody, WebinarListParams, WebinarsApi } from '../webinars';
import { retryUnlessClientError } from './calls';

export const webinarKeys = {
  all: ['webinars'] as const,
  lists: () => [...webinarKeys.all, 'list'] as const,
  list: (params: Omit<WebinarListParams, 'cursor'>) => [...webinarKeys.lists(), params] as const,
  detail: (webinarId: string) => [...webinarKeys.all, 'detail', webinarId] as const,
  messages: (webinarId: string) => [...webinarKeys.all, 'messages', webinarId] as const,
  ops: () => [...webinarKeys.all, 'ops'] as const,
  opsList: (params: Omit<WebinarListParams, 'cursor'>) => [...webinarKeys.ops(), 'list', params] as const,
  attendance: (webinarId: string) => [...webinarKeys.ops(), 'attendance', webinarId] as const,
};

/** `GET /webinars`, cursor-paged: the caller's eligible occurrences, filtered by the server. */
export const webinarListQuery = (api: WebinarsApi, params: Omit<WebinarListParams, 'cursor'> = {}) =>
  infiniteQueryOptions({
    queryKey: webinarKeys.list(params),
    queryFn: ({ pageParam }) => api.list({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: retryUnlessClientError,
  });

/** `GET /webinars/:id` */
export const webinarDetailQuery = (api: WebinarsApi, webinarId: string) =>
  queryOptions({
    queryKey: webinarKeys.detail(webinarId),
    queryFn: () => api.get(webinarId),
    retry: retryUnlessClientError,
  });

/** `GET /ops/webinars`, cursor-paged: every status. */
export const webinarOpsListQuery = (api: WebinarsApi, params: Omit<WebinarListParams, 'cursor'> = {}) =>
  infiniteQueryOptions({
    queryKey: webinarKeys.opsList(params),
    queryFn: ({ pageParam }) => api.listOps({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: retryUnlessClientError,
  });

/** `GET /ops/webinars/:id/attendance`: counts only, never names. */
export const webinarAttendanceQuery = (api: WebinarsApi, webinarId: string) =>
  queryOptions({
    queryKey: webinarKeys.attendance(webinarId),
    queryFn: () => api.attendance(webinarId),
    retry: retryUnlessClientError,
  });

export const registerWebinarMutation = (api: WebinarsApi, webinarId: string) =>
  mutationOptions({
    mutationKey: [...webinarKeys.detail(webinarId), 'register'],
    mutationFn: () => api.register(webinarId),
  });

export const unregisterWebinarMutation = (api: WebinarsApi, webinarId: string) =>
  mutationOptions({
    mutationKey: [...webinarKeys.detail(webinarId), 'unregister'],
    mutationFn: () => api.unregister(webinarId),
  });

export const startWebinarMutation = (api: WebinarsApi, webinarId: string) =>
  mutationOptions({
    mutationKey: [...webinarKeys.detail(webinarId), 'start'],
    mutationFn: () => api.start(webinarId),
  });

export const endWebinarMutation = (api: WebinarsApi, webinarId: string) =>
  mutationOptions({
    mutationKey: [...webinarKeys.detail(webinarId), 'end'],
    mutationFn: () => api.end(webinarId),
  });

export const createWebinarMutation = (api: WebinarsApi) =>
  mutationOptions({
    mutationKey: [...webinarKeys.ops(), 'create'],
    mutationFn: (body: WebinarCreateBody) => api.createOps(body),
  });

export const updateWebinarMutation = (api: WebinarsApi, webinarId: string) =>
  mutationOptions({
    mutationKey: [...webinarKeys.ops(), 'update', webinarId],
    mutationFn: (body: WebinarUpdateRequest) => api.updateOps(webinarId, body),
  });

export const publishWebinarMutation = (api: WebinarsApi, webinarId: string) =>
  mutationOptions({
    mutationKey: [...webinarKeys.ops(), 'publish', webinarId],
    mutationFn: () => api.publish(webinarId),
  });

export const cancelWebinarMutation = (api: WebinarsApi, webinarId: string) =>
  mutationOptions({
    mutationKey: [...webinarKeys.ops(), 'cancel', webinarId],
    mutationFn: () => api.cancel(webinarId),
  });
