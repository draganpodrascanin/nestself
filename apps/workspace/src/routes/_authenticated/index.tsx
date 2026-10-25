import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Heading,
  Skeleton,
  StatusBlock,
  Alert,
  ContentCard,
  DurationBadge,
  ShowMore,
  SampleDataBanner,
} from '@nestself/ui';
import type { LibraryCard } from '@nestself/contracts';
import { libraryKeys } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { isSampleDataMode } from '../../data-source';
import { api } from '../../api';
import { sampleContentCards } from '../../library/sample-library-data';
import { mapLibraryError } from '../../library/map-library-error';
import type { Locale } from '@nestself/i18n';
import {
  LibraryContentListSchema,
} from '@nestself/contracts';

const searchSchema = z.object({
  denied: z.string().optional(),
});

export const Route = createFileRoute('/_authenticated/')({
  validateSearch: searchSchema,
  component: HomePage,
});

function HomePage() {
  const { i18n } = useTranslation(['library', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { denied } = Route.useSearch();

  if (isSampleDataMode) {
    return <SampleHomePage locale={locale} denied={denied} />;
  }

  return <ApiHomePage locale={locale} denied={denied} />;
}

function SampleHomePage({ locale, denied }: { locale: string; denied?: string }) {
  const { t } = useTranslation(['library', 'common']);
  const { principal } = useAuth();
  const cards = sampleContentCards(locale);

  return (
    <div className="space-y-8">
      <SampleDataBanner message={t('common:sample.banner')} />
      {denied ? (
        <StatusBlock
          state="permission"
          title={t('common:state.permission.title')}
          body={t('common:state.permission.body')}
        />
      ) : null}

      <Heading level={1} typeRole="screenTitle">
        {t('library:home.greeting', { name: principal?.displayName ?? '' })}
      </Heading>

      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('library:home.availableResources')}
        </Heading>
        {cards.length === 0 ? (
          <StatusBlock
            state="empty"
            title={t('library:home.empty.title')}
            body={t('library:home.empty.body')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <ContentCard
                key={card.resourceId}
                resourceId={card.resourceId}
                title={card.title}
                outcome={card.summary}
                formatLabel={t('library:card.article')}
                durationBadge={
                  card.durationBand ? (
                    <DurationBadge bandLabel={t(`library:duration.${card.durationBand}`)} />
                  ) : null
                }
                href={`/content/${card.resourceId}`}
                renderLink={({ className, children }) => (
                  <Link
                    to="/content/$contentId"
                    params={{ contentId: card.resourceId }}
                    className={className}
                  >
                    {children}
                  </Link>
                )}
                placeholder
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ApiHomePage({ locale, denied }: { locale: string; denied?: string }) {
  const { t } = useTranslation(['library', 'common']);
  const { principal } = useAuth();

  const ctx = principal?.context ?? { kind: 'personal' as const };

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: libraryKeys.contentList(ctx, locale),
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return api.request(`/api/library/content${qs ? `?${qs}` : ''}`, {
        schema: LibraryContentListSchema,
        headers: { 'Accept-Language': locale },
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const allCards: LibraryCard[] = data?.pages.flatMap((page) => page.items) ?? [];
  const addedCount = isFetchingNextPage ? 0 : (data?.pages[data.pages.length - 1]?.items.length ?? 0);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Heading level={1} typeRole="screenTitle">
          {t('library:home.greeting', { name: principal?.displayName ?? '' })}
        </Heading>
        <Skeleton lines={3} label={t('common:state.loading')} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {denied ? (
        <StatusBlock
          state="permission"
          title={t('common:state.permission.title')}
          body={t('common:state.permission.body')}
        />
      ) : null}

      <Heading level={1} typeRole="screenTitle">
        {t('library:home.greeting', { name: principal?.displayName ?? '' })}
      </Heading>

      {isError ? (
        <Alert tone="danger">
          {mapLibraryError(error, t as Parameters<typeof mapLibraryError>[1])}
        </Alert>
      ) : null}

      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('library:home.availableResources')}
        </Heading>
        {allCards.length === 0 && !isError ? (
          <StatusBlock
            state="empty"
            title={t('library:home.empty.title')}
            body={t('library:home.empty.body')}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {allCards.map((card) => (
                <ContentCard
                  key={card.resourceId}
                  resourceId={card.resourceId}
                  title={card.title}
                  outcome={card.summary}
                  formatLabel={t('library:card.article')}
                  imageUrl={card.coverImageUrl}
                  durationBadge={
                    card.durationBand ? (
                      <DurationBadge bandLabel={t(`library:duration.${card.durationBand}`)} />
                    ) : null
                  }
                  saved={card.saved}
                  href={`/content/${card.resourceId}`}
                  renderLink={({ className, children }) => (
                    <Link
                      to="/content/$contentId"
                      params={{ contentId: card.resourceId }}
                      className={className}
                    >
                      {children}
                    </Link>
                  )}
                />
              ))}
            </div>
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
            />
          </>
        )}
      </section>
    </div>
  );
}
