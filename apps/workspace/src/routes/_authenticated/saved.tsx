/**
 * Saved items route — list of bookmarked library resources (T-C1.13, 9.7).
 *
 * States:
 * - loading: skeleton
 * - empty: "No saved items" with guidance
 * - populated: list with available and unavailable placeholders
 * - unavailable items: "This content is no longer available" with remove action
 *
 * Uses `useInfiniteQuery` + `ShowMore` (EMP-C05) so items past the
 * first page are reachable via cursor pagination.
 */
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRef } from 'react';
import {
  Heading,
  Text,
  Skeleton,
  StatusBlock,
  Alert,
  Button,
  Card,
  ShowMore,
  useToast,
} from '@nestself/ui';
import type { SavedItem } from '@nestself/contracts';
import { SavedItemsListSchema, can } from '@nestself/contracts';
import { savedKeys } from '@nestself/api-client';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import { isSampleDataMode } from '../../data-source';
import { api } from '../../api';
import { mapLibraryError } from '../../library/map-library-error';
import { unsaveItem } from '../../library/use-library';

export const Route = createFileRoute('/_authenticated/saved')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (
      !isSampleDataMode &&
      principal &&
      !can(principal, 'content.bookmark', undefined, effectiveActions)
    ) {
      throw redirect({ to: '/', search: { denied: 'saved' } });
    }
  },
  component: SavedPage,
});

function SavedPage() {
  const { i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  if (isSampleDataMode) {
    return <SampleSavedPage />;
  }

  return <ApiSavedPage locale={locale} />;
}

// ---------------------------------------------------------------------------
// Sample mode (no per-route SampleDataBanner — root __root.tsx renders it)
// ---------------------------------------------------------------------------

function SampleSavedPage() {
  const { t } = useTranslation(['library', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('library:saved.title')}
      </Heading>
      <StatusBlock
        state="empty"
        title={t('library:saved.empty.title')}
        body={t('library:saved.empty.body')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// API mode — infinite scroll with cursor pagination (EMP-C05)
// ---------------------------------------------------------------------------

function ApiSavedPage({ locale }: { locale: string }) {
  const { t } = useTranslation(['library', 'common']);
  const { principal } = useAuth();
  const ctx = principal?.context ?? { kind: 'personal' as const };
  const firstNewItemRef = useRef<HTMLLIElement>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: savedKeys.list(ctx, locale),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return api.request(`/api/me/saved${qs ? `?${qs}` : ''}`, {
        schema: SavedItemsListSchema,
        headers: { 'Accept-Language': locale },
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 60_000,
  });

  const allItems: SavedItem[] = data?.pages.flatMap((page) => page.items) ?? [];
  const lastPageCount = data?.pages[data.pages.length - 1]?.items.length ?? 0;
  const addedCount = isFetchingNextPage ? 0 : lastPageCount;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Heading level={1} typeRole="screenTitle">
          {t('library:saved.title')}
        </Heading>
        <Skeleton lines={3} label={t('common:state.loading')} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <Heading level={1} typeRole="screenTitle">
          {t('library:saved.title')}
        </Heading>
        <Alert tone="danger">
          {mapLibraryError(error, t as Parameters<typeof mapLibraryError>[1])}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('library:saved.title')}
      </Heading>
      {allItems.length === 0 ? (
        <StatusBlock
          state="empty"
          title={t('library:saved.empty.title')}
          body={t('library:saved.empty.body')}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {allItems.map((item, index) => {
              const lastPageStart = allItems.length - lastPageCount;
              const isFirstOfLastPage = index === lastPageStart && data != null && data.pages.length > 1;
              return (
                <li
                  key={item.resourceId}
                  ref={isFirstOfLastPage ? firstNewItemRef : undefined}
                  tabIndex={isFirstOfLastPage ? -1 : undefined}
                >
                  <SavedItemRow item={item} ctx={ctx} />
                </li>
              );
            })}
          </ul>
          <ShowMore
            label={t('library:home.showMore')}
            onLoadMore={() => void fetchNextPage()}
            loading={isFetchingNextPage}
            loadingLabel={t('library:home.showMoreLoading')}
            hasMore={!!hasNextPage}
            addedAnnouncement={
              addedCount > 0
                ? t('library:home.showMoreAnnouncement', { count: addedCount })
                : undefined
            }
            focusTargetRef={firstNewItemRef}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved item row (rendered inside a <li> by the parent)
// ---------------------------------------------------------------------------

function SavedItemRow({
  item,
  ctx,
}: {
  item: SavedItem;
  ctx: { kind: string; orgId?: string };
}) {
  const { t } = useTranslation(['library']);
  const queryClient = useQueryClient();
  const toast = useToast();

  const removeMutation = useMutation({
    mutationFn: () => unsaveItem(api, item.resourceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: savedKeys.all(ctx as Parameters<typeof savedKeys.all>[0]),
      });
    },
    onError: (err) => {
      toast.add({
        title: mapLibraryError(err, t as Parameters<typeof mapLibraryError>[1]),
        tone: 'danger',
      });
    },
  });

  if (item.status === 'unavailable') {
    return (
      <Card padding="md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text className="text-text-secondary">{t('library:saved.unavailable')}</Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeMutation.mutate()}
            loading={removeMutation.isPending}
            disabled={removeMutation.isPending}
            aria-label={t('library:saved.removeItem', { title: t('library:saved.unavailable') })}
          >
            {t('library:saved.remove')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="md" interactive>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/content/$contentId"
          params={{ contentId: item.resourceId }}
          className="block no-underline min-w-0 flex-1"
        >
          <Text className="font-[var(--font-weight-label)]">{item.title}</Text>
          {item.categoryName ? (
            <Text className="type-metadata text-text-secondary">{item.categoryName}</Text>
          ) : null}
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => removeMutation.mutate()}
          loading={removeMutation.isPending}
          disabled={removeMutation.isPending}
          aria-label={t('library:saved.removeItem', { title: item.title ?? item.resourceId })}
        >
          {t('library:saved.remove')}
        </Button>
      </div>
    </Card>
  );
}
