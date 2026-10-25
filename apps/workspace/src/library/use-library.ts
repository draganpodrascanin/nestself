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
  LibraryContentDetailSchema,
  SavedItemsListSchema,
} from '@nestself/contracts';
import type { ActiveContext } from '@nestself/contracts';
import type { ApiClient } from '@nestself/api-client';
import { ApiError, libraryKeys } from '@nestself/api-client';

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
    // 404 is a definitive "not found"; retrying wastes time.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 1;
    },
  });
}

// ---------------------------------------------------------------------------
// Save / unsave mutations (not query options, just helpers)
// ---------------------------------------------------------------------------

export function saveItem(client: ApiClient, contentId: string) {
  return client.request(`/api/me/saved/${encodeURIComponent(contentId)}`, {
    method: 'PUT',
    schema: SavedItemsListSchema, // Unused — expectBody: false skips parsing
    expectBody: false,
  });
}

export function unsaveItem(client: ApiClient, contentId: string) {
  return client.request(`/api/me/saved/${encodeURIComponent(contentId)}`, {
    method: 'DELETE',
    schema: SavedItemsListSchema, // Unused — expectBody: false skips parsing
    expectBody: false,
  });
}
