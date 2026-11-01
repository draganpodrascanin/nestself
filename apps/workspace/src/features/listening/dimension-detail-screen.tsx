import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Card, Heading, Skeleton, StatusBlock, Table, Td, Text, Th, buttonClassNames } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { can } from '@nestself/contracts';
import type { ListeningDimensionDetailResponse, ListeningDimensionKey } from '@nestself/contracts';
import { useAuth } from '../../auth';
import { useOrgContext } from '../people/use-org-context';
import { DimensionCard } from './dimension-card';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { sampleDimension } from './sample-listening';
import { scoreTone, statusKey } from './score-tone';
import { useDimension } from './use-listening';

export interface DimensionDetailScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  dimensionKey: ListeningDimensionKey;
  snapshotId?: string;
}

function localized(text: Record<string, string>, locale: Locale): string {
  return text[locale] ?? text.en ?? '';
}

/**
 * One dimension in depth (spec REP-03): the question and scale, the safe
 * distribution, the comparable history, and the entry point to request a
 * human review. No respondents, no completion, no generated advice.
 */
export function DimensionDetailScreen({ listeningApi, sampleMode, dimensionKey, snapshotId }: DimensionDetailScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { principal, effectiveActions } = useAuth();
  const { orgId, needsChoice, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useDimension(listeningApi, apiOrgId, dimensionKey, snapshotId ?? null);
  const canRequest = principal ? can(principal, 'workplace_reviews.request', undefined, effectiveActions) : false;
  const title = t(`listening:dimensions.${dimensionKey}.title`);

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{title}</Heading>
      <Link to="/listening" className="type-label text-primary underline">
        {t('listening:dimension.back')}
      </Link>
    </div>
  );

  if (!principal || orgId === null) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">{t(needsChoice ? 'workspace:people.chooseOrganization' : 'workspace:people.noOrganization', { ns: 'workspace' })}</Alert>
      </div>
    );
  }
  if (!sampleMode && (switchError || query.isError)) {
    const key = listeningErrorMessageKey(switchError ?? query.error);
    if (key === 'listening:errors.notFound') {
      return (
        <div className="space-y-6">
          {header}
          <StatusBlock state="empty" title={t('listening:overview.noResults')} body={t('listening:overview.noResultsBody')} />
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{t(key ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!sampleMode && query.isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={6} label={t('common:state.loading')} />
      </div>
    );
  }
  const detail: ListeningDimensionDetailResponse | undefined = sampleMode ? sampleDimension(dimensionKey) : query.data;
  if (!detail) return <div className="space-y-6">{header}</div>;

  return (
    <div className="space-y-8">
      {header}
      <div className="grid gap-4 lg:grid-cols-2">
        <DimensionCard card={detail.cell} stale={detail.stale} detailTo={false} />
        <Card padding="md" className="space-y-3" as="section" aria-labelledby="dimension-definition">
          <Heading level={2} typeRole="sectionTitle" id="dimension-definition">
            {t('listening:dimension.question')}
          </Heading>
          <Text>{localized(detail.question, locale)}</Text>
          <Text tone="secondary" typeRole="metadata">
            {t('listening:dimension.scaleText', { low: localized(detail.scaleLow, locale), high: localized(detail.scaleHigh, locale) })}
          </Text>
          <Text tone="secondary" typeRole="metadata">
            {t('listening:dimension.explanation')}: {localized(detail.explanation, locale)}
          </Text>
        </Card>
      </div>

      <section aria-labelledby="dimension-distribution" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="dimension-distribution">
          {t('listening:dimension.distribution')}
        </Heading>
        {detail.cell.distribution ? (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                ['favorable', detail.cell.distribution.favorablePct, 'success'],
                ['neutral', detail.cell.distribution.neutralPct, 'neutral'],
                ['unfavorable', detail.cell.distribution.unfavorablePct, 'danger'],
              ] as const
            ).map(([key, pct, tone]) => (
              <div key={key} className="rounded-card border border-border-subtle p-3">
                <dt className="type-metadata text-text-secondary">{t(`listening:dimension.${key}`)}</dt>
                <dd className="flex items-center gap-2">
                  <span className="type-section-title">{pct}%</span>
                  <Badge tone={tone}>{t(`listening:dimension.${key}`)}</Badge>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <Text tone="secondary">{t(statusKey(detail.cell))}</Text>
        )}
      </section>

      <section aria-labelledby="dimension-history" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="dimension-history">
          {t('listening:dimension.history')}
        </Heading>
        <Table density="compact">
          <thead>
            <tr>
              <Th>{t('listening:dimension.period')}</Th>
              <Th numeric>{t('listening:dimension.score')}</Th>
              <Th>{t('listening:dimension.status')}</Th>
              <Th>{t('listening:dimension.comparable')}</Th>
            </tr>
          </thead>
          <tbody>
            {detail.series.map((point) => (
              <tr key={point.snapshotId}>
                <Td>{formatDate(point.closesAt, locale)}</Td>
                <Td numeric>{point.scoreTenths !== null ? `${Math.floor(point.scoreTenths / 10)}.${point.scoreTenths % 10}%` : t('listening:heatmap.hidden')}</Td>
                <Td>
                  <Badge tone={scoreTone(point)}>{t(statusKey(point))}</Badge>
                </Td>
                <Td>{point.comparable ? t('listening:dimension.comparable') : t('listening:dimension.notComparable')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {canRequest ? (
        <Card tone="subtle" padding="md" className="space-y-2" as="section" aria-labelledby="dimension-review">
          <Heading level={2} typeRole="sectionTitle" id="dimension-review">
            {t('listening:dimension.requestReview')}
          </Heading>
          <Text>{t('listening:dimension.requestReviewBody')}</Text>
          <Link to="/listening/reviews/new" className={buttonClassNames({ variant: 'secondary', size: 'sm' })}>
            {t('listening:dimension.requestReview')}
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
