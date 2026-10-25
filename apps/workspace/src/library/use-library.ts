/**
 * Library query-option factories for TanStack Query.
 *
 * Each factory returns a `queryOptions` object keyed by `libraryKeys`/`savedKeys`
 * so that context switches and language changes invalidate the correct caches.
 *
 * The API client sends `Accept-Language` with every library request (C-28).
 *
 * @see CLI-R-07, CLI-R-13, LIB-R-31
 */
import { queryOptions } from '@tanstack/react-query';
import {
  LibraryContentListSchema,
  LibraryContentDetailSchema,
  SavedItemsListSchema,
} from '@nestself/contracts';
import type { ActiveContext } from '@nestself/contracts';
import type { ApiClient } from '@nestself/api-client';
import { libraryKeys, savedKeys } from '@nestself/api-client';

// ---------------------------------------------------------------------------
// Content list
// ---------------------------------------------------------------------------

export function libraryContentListOptions(
  client: ApiClient,
  ctx: ActiveContext,
  locale: string,
  cursor?: string | null,
) {
  return queryOptions({
    queryKey: [...libraryKeys.contentList(ctx, locale), cursor ?? 'initial'] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      const qs = params.toString();
      return client.request(`/api/library/content${qs ? `?${qs}` : ''}`, {
        schema: LibraryContentListSchema,
        headers: { 'Accept-Language': locale },
      });
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Content detail
// ---------------------------------------------------------------------------

export function libraryContentDetailOptions(
  client: ApiClient,
  ctx: ActiveContext,
  contentId: string,
  locale: string,
) {
  return queryOptions({
    queryKey: libraryKeys.contentDetail(ctx, contentId, locale),
    queryFn: () =>
      client.request(`/api/library/content/${encodeURIComponent(contentId)}`, {
        schema: LibraryContentDetailSchema,
        headers: { 'Accept-Language': locale },
      }),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Saved items
// ---------------------------------------------------------------------------

export function savedItemsListOptions(
  client: ApiClient,
  ctx: ActiveContext,
  locale: string,
) {
  return queryOptions({
    queryKey: savedKeys.list(ctx, locale),
    queryFn: () =>
      client.request('/api/me/saved', {
        schema: SavedItemsListSchema,
        headers: { 'Accept-Language': locale },
      }),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Save / unsave mutations (not query options, just helpers)
// ---------------------------------------------------------------------------

export function saveItem(client: ApiClient, contentId: string) {
  return client.request(`/api/me/saved/${encodeURIComponent(contentId)}`, {
    method: 'PUT',
    schema: undefined as unknown as never,
    expectBody: false,
  });
}

export function unsaveItem(client: ApiClient, contentId: string) {
  return client.request(`/api/me/saved/${encodeURIComponent(contentId)}`, {
    method: 'DELETE',
    schema: undefined as unknown as never,
    expectBody: false,
  });
}
