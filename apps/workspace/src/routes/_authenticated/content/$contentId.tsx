/**
 * Content detail route — shows a single library resource (T-C1.13, 9.13).
 *
 * States (9.10):
 * - loading: skeleton
 * - 404 content_not_available: neutral "This content is not available" (never reveals a title)
 * - network error: alert with retry
 * - populated: title, summary, outcome, duration, reviewer, date, ContentRenderer, save
 */
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Heading,
  Text,
  Skeleton,
  StatusBlock,
  Alert,
  Button,
  Badge,
  DurationBadge,
  useToast,
} from '@nestself/ui';
import { ContentRenderer } from '@nestself/content/render';
import type {
  MediaUrlResolver,
  MediaAssetMeta,
  ContentRendererLabels,
  LinkComponentType,
  ResolvedCta,
} from '@nestself/content/render';
import type { LibraryContentDetail } from '@nestself/contracts';
import { can } from '@nestself/contracts';
import { ApiError, libraryKeys, savedKeys } from '@nestself/api-client';
import type { Locale } from '@nestself/i18n';
import { formatDate } from '@nestself/i18n';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { api } from '../../../api';
import { sampleContentDetail } from '../../../library/sample-library-data';
import { mapLibraryError } from '../../../library/map-library-error';
import { libraryContentDetailOptions, saveItem, unsaveItem } from '../../../library/use-library';
import { useState } from 'react';

export const Route = createFileRoute('/_authenticated/content/$contentId')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (
      !isSampleDataMode &&
      principal &&
      !can(principal, 'content.read', undefined, effectiveActions)
    ) {
      throw redirect({ to: '/', search: { denied: 'content' } });
    }
  },
  component: ContentDetailPage,
});

function ContentDetailPage() {
  const { contentId } = Route.useParams();
  const { i18n } = useTranslation(['library', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  if (isSampleDataMode) {
    return <SampleDetailPage contentId={contentId} locale={locale} />;
  }

  return <ApiDetailPage contentId={contentId} locale={locale} />;
}

// ---------------------------------------------------------------------------
// Sample mode
// ---------------------------------------------------------------------------

function SampleDetailPage({ contentId, locale }: { contentId: string; locale: string }) {
  const { t } = useTranslation(['library', 'common']);
  const detail = sampleContentDetail(contentId, locale);
  const [showSaveDemo, setShowSaveDemo] = useState(false);

  if (!detail) {
    return (
      <div className="space-y-6 max-w-reading">
        <Heading level={1} className="sr-only">
          {t('library:content.unavailable')}
        </Heading>
        <StatusBlock
          state="empty"
          title={t('library:content.unavailable')}
          body=""
        />
      </div>
    );
  }

  return (
    <DetailView
      detail={detail}
      locale={locale}
      onToggleSave={() => setShowSaveDemo(true)}
      saveDemoMessage={showSaveDemo ? t('library:detail.saveDemo') : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// API mode
// ---------------------------------------------------------------------------

function ApiDetailPage({ contentId, locale }: { contentId: string; locale: string }) {
  const { t } = useTranslation(['library', 'common']);
  const { principal } = useAuth();
  const ctx = principal?.context ?? { kind: 'personal' as const };
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading, isError, error, refetch } = useQuery(
    libraryContentDetailOptions(api, ctx, contentId, locale),
  );

  const saveMutation = useMutation({
    mutationFn: () => saveItem(api, contentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.contentDetail(ctx, contentId, locale) });
      void queryClient.invalidateQueries({ queryKey: libraryKeys.all(ctx) });
      void queryClient.invalidateQueries({ queryKey: savedKeys.all(ctx) });
    },
    onError: (err) => {
      toast.add({
        title: mapLibraryError(err, t as Parameters<typeof mapLibraryError>[1]),
        tone: 'danger',
      });
    },
  });

  const unsaveMutation = useMutation({
    mutationFn: () => unsaveItem(api, contentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.contentDetail(ctx, contentId, locale) });
      void queryClient.invalidateQueries({ queryKey: libraryKeys.all(ctx) });
      void queryClient.invalidateQueries({ queryKey: savedKeys.all(ctx) });
    },
    onError: (err) => {
      toast.add({
        title: mapLibraryError(err, t as Parameters<typeof mapLibraryError>[1]),
        tone: 'danger',
      });
    },
  });

  if (isLoading) {
    return <Skeleton lines={5} label={t('common:state.loading')} />;
  }

  if (isError) {
    // 404: neutral message, never reveal a title (9.10)
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="space-y-6 max-w-reading">
          <Heading level={1} className="sr-only">
            {t('library:error.contentNotAvailable')}
          </Heading>
          <StatusBlock
            state="empty"
            title={t('library:error.contentNotAvailable')}
            body=""
          />
        </div>
      );
    }

    return (
      <div className="space-y-6 max-w-reading">
        <Heading level={1} className="sr-only">
          {t('library:error.contentNotAvailable')}
        </Heading>
        <Alert tone="danger">
          {mapLibraryError(error, t as Parameters<typeof mapLibraryError>[1])}
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {t('common:action.retry', { defaultValue: 'Try again' })}
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6 max-w-reading">
        <Heading level={1} className="sr-only">
          {t('library:error.contentNotAvailable')}
        </Heading>
        <StatusBlock
          state="empty"
          title={t('library:error.contentNotAvailable')}
          body=""
        />
      </div>
    );
  }

  const isMutating = saveMutation.isPending || unsaveMutation.isPending;

  const handleToggleSave = () => {
    if (isMutating) return;
    if (data.saved) {
      unsaveMutation.mutate();
    } else {
      saveMutation.mutate();
    }
  };

  return (
    <DetailView
      detail={data}
      locale={locale}
      onToggleSave={handleToggleSave}
      savePending={isMutating}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared detail view
// ---------------------------------------------------------------------------

const RendererLinkComponent: LinkComponentType = ({ href, children, className }) => {
  // Internal links (starting with /) use TanStack Router Link (FMT-R-17)
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
};

function mediaUrl(assetId: string, rendition: string): string {
  return `/api/library/media/${encodeURIComponent(assetId)}/${rendition}`;
}

interface DetailViewProps {
  detail: LibraryContentDetail;
  locale: string;
  onToggleSave?: () => void;
  savePending?: boolean;
  saveDemoMessage?: string;
}

function DetailView({ detail, locale, onToggleSave, savePending, saveDemoMessage }: DetailViewProps) {
  const { t } = useTranslation(['library', 'common']);

  const rendererLabels: ContentRendererLabels = {
    transcript: t('library:renderer.transcript'),
    noteWarning: t('library:renderer.noteWarning'),
    noteTip: t('library:renderer.noteTip'),
    noteDisclaimer: t('library:renderer.noteDisclaimer'),
    noteDefault: t('library:renderer.noteDefault'),
    checklist: t('library:renderer.checklist'),
    opensInNewTab: t('library:renderer.opensInNewTab'),
    downloadPdf: t('library:renderer.downloadPdf'),
    imageUnavailable: t('library:renderer.imageUnavailable'),
  };

  // Build media metadata with width/height/focalPoint (FMT-R-18)
  const mediaMeta: Record<string, MediaAssetMeta> = {};
  for (const m of detail.media) {
    mediaMeta[m.assetId] = {
      kind: m.kind as MediaAssetMeta['kind'],
      renditions: m.renditions.map((r) => r.kind),
      width: m.width ?? undefined,
      height: m.height ?? undefined,
      focalPoint: m.focalPoint ?? undefined,
    };
  }

  /** Translated fallback label for a CTA kind when the API label is null. */
  const ctaLabel = (kind: string, apiLabel?: string | null): string => {
    if (apiLabel) return apiLabel;
    // Known CTA kinds get a translated default; unknown kinds fall back
    const key = `library:detail.cta.${kind}` as const;
    const translated = t(key, { defaultValue: '' });
    return translated || t('library:detail.cta.default');
  };

  // Resolve CTA from the read model (LIB-R-23).
  // The API drops unavailable targets, so if `detail.cta.target` is present,
  // the CTA is actionable. When `label` becomes optional (contract change),
  // we fall back to a translated label per kind.
  const resolveCta = (cta: { ctaKind: string; targetId?: string | null; label?: string | null }): ResolvedCta | null => {
    if (!detail.cta) return null;
    if (detail.cta.target) {
      return {
        kind: 'link' as const,
        href: detail.cta.target,
        label: ctaLabel(detail.cta.kind, cta.label ?? detail.cta.label),
      };
    }
    // CTA without a target: nothing to link to
    return null;
  };

  // LIB-R-27: replacement link for unavailable content.
  // The contract field is being added; when it lands, render a Link here.
  // TODO(T-C1.13): Wire `detail.replacementResourceId` once the field name is settled.

  return (
    <div className="space-y-6 max-w-reading">
      <Link to="/" className="type-metadata text-text-secondary hover:text-primary no-underline">
        &larr; {t('library:detail.backToHome')}
      </Link>

      <Heading level={1} typeRole="screenTitle">
        {detail.title}
      </Heading>

      <Text className="type-body text-text-secondary">{detail.summary}</Text>

      {/* Metadata row */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="neutral">{detail.category.label}</Badge>
        {detail.durationSeconds != null ? (
          <DurationBadge
            durationSeconds={detail.durationSeconds}
            formatLabel={(seconds) => {
              const minutes = Math.round(seconds / 60);
              if (minutes < 1) return t('library:durationFormat.lessThanMinute');
              return t('library:durationFormat.minutes', { count: minutes });
            }}
          />
        ) : detail.durationBand ? (
          <DurationBadge bandLabel={t(`library:duration.${detail.durationBand}`)} />
        ) : null}
      </div>

      {/* Outcome */}
      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-2">
          {t('library:detail.outcome')}
        </Heading>
        <Text>{detail.outcome}</Text>
      </section>

      {/* Reviewer and date — use formatDate not formatDateTime (Minor) */}
      {detail.reviewerName ? (
        <div className="type-metadata text-text-secondary">
          <span>{t('library:detail.reviewedBy', { name: detail.reviewerName })}</span>
          {detail.reviewedAt ? (
            <span>
              {' · '}
              {t('library:detail.reviewedOn', {
                date: formatDate(new Date(detail.reviewedAt), locale as Locale),
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Content body */}
      {detail.body &&
      typeof detail.body === 'object' &&
      'type' in (detail.body as Record<string, unknown>) ? (
        <ContentRenderer
          document={
            detail.body as {
              type: 'doc';
              schemaVersion: number;
              content: unknown[];
            }
          }
          media={mediaMeta}
          mediaUrl={mediaUrl as MediaUrlResolver}
          resolveCta={resolveCta}
          resolveRelated={(id) => {
            const rel = detail.relatedResources.find((r) => r.resourceId === id);
            if (!rel) return null;
            return {
              title: rel.title,
              href: `/content/${rel.resourceId}`,
              description: rel.summary,
            };
          }}
          resolveInternalLink={(id) => `/content/${id}`}
          linkComponent={RendererLinkComponent}
          labels={rendererLabels}
          documentKey={detail.id}
        />
      ) : null}

      {/* Save button */}
      {onToggleSave ? (
        <div className="pt-4 border-t border-border-subtle">
          <Button
            variant="secondary"
            onClick={onToggleSave}
            aria-pressed={detail.saved}
            loading={savePending}
            disabled={savePending}
          >
            {detail.saved
              ? t('library:detail.unsave')
              : t('library:detail.save')}
          </Button>
          {saveDemoMessage ? (
            <Text className="mt-2 type-metadata text-text-secondary">
              {saveDemoMessage}
            </Text>
          ) : null}
        </div>
      ) : null}

      {/* Sources */}
      {detail.sources.length > 0 ? (
        <section>
          <Heading level={2} typeRole="sectionTitle" className="mb-2">
            {t('library:detail.sources')}
          </Heading>
          <ul className="list-disc pl-5 space-y-1">
            {detail.sources.map((source, i) => (
              <li key={i}>
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-info hover:underline"
                  >
                    {source.label}
                  </a>
                ) : (
                  <span>{source.label}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Related resources */}
      {detail.relatedResources.length > 0 ? (
        <section>
          <Heading level={2} typeRole="sectionTitle" className="mb-2">
            {t('library:detail.related')}
          </Heading>
          <div className="space-y-2">
            {detail.relatedResources.map((rel) => (
              <Link
                key={rel.resourceId}
                to="/content/$contentId"
                params={{ contentId: rel.resourceId }}
                className="block p-3 rounded-card border border-border-subtle hover:border-primary transition-colors no-underline"
              >
                <Text className="font-[var(--font-weight-label)]">{rel.title}</Text>
                <Text className="type-metadata text-text-secondary">
                  {rel.summary}
                </Text>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
