import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, Skeleton, StatusBlock, Text, buttonClassNames, useToast } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { DEFAULT_LISTENING_POLICY, can } from '@nestself/contracts';
import type { ListeningOverviewResponse } from '@nestself/contracts';
import { useAuth } from '../../auth';
import { useOrgContext } from '../people/use-org-context';
import { DimensionCard } from './dimension-card';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { ReviewOfferCard } from './review-offer-card';
import { sampleOverview } from './sample-listening';
import { useDismissOffer, useExportCsv, useListeningConfiguration, useOverview } from './use-listening';

export interface OverviewScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/**
 * The listening overview (spec REP-01, SCO-02, REV-01): five dimension cards
 * of the latest published cycle with the period, participation context,
 * trends and freshness; the collecting state; the one review invitation; and
 * the CSV export for holders of `listening.reports.export`.
 */
export function OverviewScreen({ listeningApi, sampleMode }: OverviewScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { principal, effectiveActions } = useAuth();
  const { orgId, needsChoice, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useOverview(listeningApi, apiOrgId);
  // The client's own rules (minimum cohort, freshness window); the platform defaults until they load or in sample mode.
  const configuration = useListeningConfiguration(listeningApi, apiOrgId);
  const minimumCohort = configuration.data?.minimumCohort ?? DEFAULT_LISTENING_POLICY.minimumCohort;
  const freshnessDays = configuration.data?.freshnessDays ?? DEFAULT_LISTENING_POLICY.freshnessDays;
  const dismiss = useDismissOffer(listeningApi, orgId ?? '');
  const exportCsv = useExportCsv(listeningApi, orgId ?? '');
  const { add: addToast } = useToast();
  const allowed = (action: string) => (principal ? can(principal, action, undefined, effectiveActions) : false);
  const canExport = allowed('listening.reports.export');
  const canRequest = allowed('workplace_reviews.request');

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:overview.title')}</Heading>
      <Text tone="secondary">{t('listening:overview.lead')}</Text>
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
  if (!sampleMode && switchError) {
    const key = listeningErrorMessageKey(switchError);
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
        <Skeleton lines={5} label={t('common:state.loading')} />
      </div>
    );
  }
  if (!sampleMode && query.isError) {
    const key = listeningErrorMessageKey(query.error);
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{t(key ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }

  const overview: ListeningOverviewResponse | undefined = sampleMode ? sampleOverview() : query.data;
  if (!overview) return <div className="space-y-6">{header}</div>;

  if (!overview.capabilities.measurement && !overview.current) {
    return (
      <div className="space-y-6">
        {header}
        <StatusBlock state="permission" title={t('listening:overview.capabilityOff')} body={t('listening:settings.lead')} />
      </div>
    );
  }

  const current = overview.current;
  return (
    <div className="space-y-8">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:cycles.sampleNote')}</Alert> : null}

      {overview.collecting ? (
        <Alert tone="info" title={t('listening:overview.collecting')}>
          {t('listening:overview.collectingBody', { date: formatDate(overview.collecting.closesAt, locale) })}
        </Alert>
      ) : null}

      {!current ? (
        <StatusBlock state="empty" title={t('listening:overview.noResults')} body={t('listening:overview.noResultsBody')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Text tone="secondary" typeRole="metadata">
                {t('listening:overview.period', { from: formatDate(current.opensAt, locale), to: formatDate(current.closesAt, locale) })}
              </Text>
              <Text tone="secondary" typeRole="metadata">
                {current.participation.submittedCount !== null && current.participation.audienceSize !== null
                  ? t('listening:overview.participation', { submitted: current.participation.submittedCount, audience: current.participation.audienceSize })
                  : t('listening:overview.participationHidden', { minimum: minimumCohort })}
              </Text>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/listening/heatmap" className={buttonClassNames({ variant: 'secondary', size: 'sm' })}>
                {t('listening:overview.viewHeatmap')}
              </Link>
              {canExport ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={sampleMode || exportCsv.isPending}
                  onClick={() =>
                    exportCsv.mutate(current.snapshotId, {
                      onError: (error) => {
                        const key = listeningErrorMessageKey(error);
                        if (key) addToast({ title: t('listening:export.failed'), description: t(key), tone: 'danger' });
                      },
                    })
                  }
                >
                  {exportCsv.isPending ? t('listening:export.downloading') : t('listening:export.action')}
                </Button>
              ) : null}
            </div>
          </div>

          {current.stale ? (
            <Alert tone="warning" title={t('listening:overview.stale', { days: freshnessDays })}>
              {t('listening:overview.staleBody')}
            </Alert>
          ) : null}

          {overview.reviewOffer && canRequest ? (
            <ReviewOfferCard
              offer={overview.reviewOffer}
              dimensions={current.dimensions}
              canDismiss={!sampleMode}
              dismissing={dismiss.isPending}
              onDismiss={() =>
                dismiss.mutate(
                  { snapshotId: current.snapshotId },
                  {
                    onError: (error) => {
                      const key = listeningErrorMessageKey(error);
                      if (key) addToast({ title: t(key), tone: 'danger' });
                    },
                  },
                )
              }
            />
          ) : null}

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('listening:overview.title')}>
            {current.dimensions.map((card) => (
              <li key={card.key} className="list-none">
                <DimensionCard card={card} stale={current.stale} />
              </li>
            ))}
          </ul>
          <Text tone="secondary" typeRole="metadata">
            {t('listening:overview.measurementNote')}
          </Text>
        </>
      )}
    </div>
  );
}
