import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, DataList, Heading, Skeleton, Text } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningConfigurationResponse } from '@nestself/contracts';
import { useAuth } from '../../auth';
import { useOrgContext } from '../people/use-org-context';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { sampleConfiguration } from './sample-listening';
import { useListeningConfiguration } from './use-listening';

export interface ListeningSettingsScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/**
 * The organization's read-only view of what NestSelf configured (spec CFG-01,
 * "Settings: granted configuration, entitlements and report visibility").
 * Recipient routes of the feedback channel join this screen with that module.
 */
export function ListeningSettingsScreen({ listeningApi, sampleMode }: ListeningSettingsScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { principal } = useAuth();
  const { orgId, needsChoice, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useListeningConfiguration(listeningApi, apiOrgId);
  // Read the clock once per mount: render stays pure and the three badges agree on "now".
  const [now] = useState(() => Date.now());

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:settings.title')}</Heading>
      <Text tone="secondary">{t('listening:settings.lead')}</Text>
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
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title={t('listening:settings.loadFailed')}>
          {t(key ?? 'listening:errors.unknown')}
        </Alert>
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
  const config: ListeningConfigurationResponse | undefined = sampleMode ? sampleConfiguration() : query.data;
  if (!config) return <div className="space-y-6">{header}</div>;

  const window = (from: string | null, until: string | null) =>
    [from ? t('listening:settings.from', { date: formatDate(from, locale) }) : null, until ? t('listening:settings.until', { date: formatDate(until, locale) }) : null]
      .filter(Boolean)
      .join(' ');
  const capability = (from: string | null, until: string | null) => {
    const on = !!from && new Date(from).getTime() <= now && (!until || now < new Date(until).getTime());
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Badge tone={on ? 'success' : 'neutral'}>{on ? t('listening:settings.enabled') : t('listening:settings.disabled')}</Badge>
        <span className="type-metadata text-text-secondary">{window(from, until)}</span>
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {header}
      <section aria-labelledby="settings-capabilities" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="settings-capabilities">
          {t('listening:settings.capabilities')}
        </Heading>
        <dl className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['measurement', config.measurementFrom, config.measurementUntil],
              ['feedback', config.feedbackFrom, config.feedbackUntil],
              ['workplaceReviews', config.workplaceReviewsFrom, config.workplaceReviewsUntil],
            ] as const
          ).map(([key, from, until]) => (
            <div key={key} className="rounded-card border border-border-subtle p-3">
              <dt className="type-label">{t(`listening:settings.${key}`)}</dt>
              <dd>{capability(from, until)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="settings-rules" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="settings-rules">
          {t('listening:settings.rules')}
        </Heading>
        <DataList
          items={[
            { term: t('listening:settings.minimumCohort', { count: config.minimumCohort }), description: '' },
            { term: t('listening:settings.freshness', { days: config.freshnessDays }), description: '' },
            {
              term: t('listening:settings.thresholds', { good: `${Math.floor(config.goodThresholdTenths / 10)}.${config.goodThresholdTenths % 10}`, monitor: `${Math.floor(config.monitorThresholdTenths / 10)}.${config.monitorThresholdTenths % 10}` }),
              description: '',
            },
            { term: t('listening:cycles.cadence', { days: config.cadenceDays }), description: t('listening:cycles.window', { days: config.responseWindowDays }) },
            { term: t('listening:settings.policyVersion', { version: config.policyVersion }), description: t('listening:settings.timeZone', { zone: config.timeZone }) },
          ]}
        />
      </section>
    </div>
  );
}
