import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { z } from 'zod';
import {
  Heading,
  Skeleton,
  StatusBlock,
  Alert,
  ContentCard,
  DurationBadge,
  ShowMore,
} from '@nestself/ui';
import type { LibraryCard } from '@nestself/contracts';
import { LibraryContentListSchema, can } from '@nestself/contracts';
import { libraryKeys } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { NextAppointment } from '../../calls/next-appointment';
import { listeningApi } from '../../features/listening/listening-api';
import { SurveyHomeCard } from '../../features/listening/survey-home-card';
import { isSampleDataMode } from '../../data-source';
import { api } from '../../api';
import { sampleContentCards } from '../../library/sample-library-data';
import { mapLibraryError } from '../../library/map-library-error';
import type { Locale } from '@nestself/i18n';

const searchSchema = z.object({
  denied: z.string().optional(),
});

/** Resolve a card's content type to its i18n label key. */
function cardFormatKey(type: string): string {
  switch (type) {
    case 'video': return 'library:card.video';
    case 'audio': return 'library:card.audio';
    case 'practical': return 'library:card.guide';
    case 'collection': return 'library:card.course';
    case 'qa': return 'library:card.qa';
    default: return 'library:card.article';
  }
}

export const Route = createFileRoute('/_authenticated/')({
  validateSearch: searchSchema,
  component: HomePage,
});

function HomePage() {
  const { i18n, t } = useTranslation(['library', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { denied } = Route.useSearch();
  const { principal, effectiveActions } = useAuth();

  const canRead =
    isSampleDataMode ||
    (principal ? can(principal, 'content.read', undefined, effectiveActions) : false);

  if (!canRead) {
    // No content.read: show greeting and permission block, don't call the library API
    return (
      <div className="space-y-8">
        <Heading level={1} typeRole="screenTitle">
          {t('library:home.greeting', { name: principal?.displayName ?? '' })}
        </Heading>
        <StatusBlock
          state="permission"
          title={t('common:state.permission.title')}
          body={t('common:state.permission.body')}
        />
      </div>
    );
  }

  if (isSampleDataMode) {
    return <SampleHomePage locale={locale} denied={denied} />;
  }

  return <ApiHomePage locale={locale} denied={denied} />;
}

/** Next appointment section (CALL-02): for users who can hold consultations. */
function UpcomingAppointmentSection() {
  const { t } = useTranslation(['workspace']);
  const { principal, effectiveActions } = useAuth();
  const showUpcoming = principal ? can(principal, 'consultation.join', undefined, effectiveActions) : false;

  if (!showUpcoming) return null;

  return (
    <section>
      <Heading level={2} typeRole="sectionTitle" className="mb-4">
        {t('workspace:home.upcoming')}
      </Heading>
      <NextAppointment />
    </section>
  );
}

/** The open survey's entry card (spec EMP-01): for holders of `listening.respond.self`. */
function SurveySection() {
  const { principal, effectiveActions } = useAuth();
  const show = isSampleDataMode || (principal ? can(principal, 'listening.respond.self', undefined, effectiveActions) : false);
  if (!show) return null;
  const ctx = principal?.context;
  const orgId = ctx && 'orgId' in ctx ? (ctx.orgId ?? null) : null;
  const organizationName = principal?.memberships.find((m) => m.orgId === orgId)?.orgName ?? principal?.memberships[0]?.orgName ?? null;
  return <SurveyHomeCard listeningApi={listeningApi} sampleMode={isSampleDataMode} organizationName={organizationName} />;
}

// No per-route SampleDataBanner — root __root.tsx renders it (Minor: duplicate banner)

function SampleHomePage({ locale, denied }: { locale: string; denied?: string }) {
  const { t } = useTranslation(['library', 'common']);
  const { principal } = useAuth();
  const cards = sampleContentCards(locale);

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

      <SurveySection />
      <UpcomingAppointmentSection />

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
                formatLabel={t(cardFormatKey(card.type))}
                durationBadge={
                  card.durationBand ? (
                    <DurationBadge
                      bandLabel={t(`library:duration.${card.durationBand}`)}
                      formatLabel={(s) => {
                        const m = Math.round(s / 60);
                        return m < 1 ? t('library:durationFormat.lessThanMinute') : t('library:durationFormat.minutes', { count: m });
                      }}
                    />
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
  const firstNewCardRef = useRef<HTMLDivElement | null>(null);

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
  const lastPageCount = data?.pages[data.pages.length - 1]?.items.length ?? 0;
  const addedCount = isFetchingNextPage ? 0 : lastPageCount;

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

      <SurveySection />
      <UpcomingAppointmentSection />

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
              {allCards.map((card, index) => {
                const lastPageStart = allCards.length - lastPageCount;
                const isFirstOfLastPage = index === lastPageStart && data != null && data.pages.length > 1;
                return (
                  <div key={card.resourceId} ref={isFirstOfLastPage ? firstNewCardRef : undefined} tabIndex={isFirstOfLastPage ? -1 : undefined}>
                    <ContentCard
                      resourceId={card.resourceId}
                      title={card.title}
                      outcome={card.summary}
                      formatLabel={t(cardFormatKey(card.type))}
                      imageUrl={card.coverImageUrl}
                      durationBadge={
                        card.durationBand ? (
                          <DurationBadge
                            bandLabel={t(`library:duration.${card.durationBand}`)}
                            formatLabel={(s) => {
                              const m = Math.round(s / 60);
                              return m < 1 ? t('library:durationFormat.lessThanMinute') : t('library:durationFormat.minutes', { count: m });
                            }}
                          />
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
                  </div>
                );
              })}
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
              focusTargetRef={firstNewCardRef}
            />
          </>
        )}
      </section>
    </div>
  );
}
