import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Heading, Skeleton, StatusBlock, Table, Td, Text, Th } from '@nestself/ui';
import type { ReviewEngagementResponse } from '@nestself/contracts';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { ENGAGEMENT_TONE, engagementStatusKey, scopeLabel } from './review-labels';
import { sampleMyEngagements } from './sample-reviews-ops';
import { useExpertContext, useMyEngagements } from './use-reviews-ops';

export interface EngagementsScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/** The reviewer's engagements (spec REV-07): only those assigned to them, with status and meeting. */
export function EngagementsScreen({ listeningApi, sampleMode }: EngagementsScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { ready, error: switchError } = useExpertContext(sampleMode);
  const query = useMyEngagements(listeningApi, ready);
  const items: ReviewEngagementResponse[] | undefined = sampleMode ? sampleMyEngagements() : query.data?.items;

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:reviewOps.reviewer.title')}</Heading>
      <Text tone="secondary">{t('listening:reviewOps.reviewer.lead')}</Text>
    </div>
  );
  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : switchError ? (`listening:errors.${switchError}` as const) : null;
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{t(key ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={4} label={t('common:state.loading')} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:reviewOps.reviewer.sampleNote')}</Alert> : null}
      {items.length === 0 ? (
        <StatusBlock state="empty" title={t('listening:reviewOps.reviewer.empty')} body={t('listening:reviewOps.reviewer.lead')} />
      ) : (
        <Table caption={t('listening:reviewOps.reviewer.title')}>
          <thead>
            <tr>
              <Th>{t('listening:reviews.columns.scope')}</Th>
              <Th>{t('listening:reviews.columns.status')}</Th>
              <Th>{t('listening:reviews.columns.meeting')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <Td>
                  <Link to="/reviews/engagements/$engagementId" params={{ engagementId: e.id }} className="type-label text-primary underline">
                    {e.scope.title}
                  </Link>
                  <Text tone="secondary" typeRole="metadata">
                    {scopeLabel(t, e.scopeCohortKey)} · {e.dimensionKeys.map((k) => t(`listening:dimensions.${k}.short`)).join(', ')}
                  </Text>
                </Td>
                <Td>
                  <Badge tone={ENGAGEMENT_TONE[e.status]}>{t(engagementStatusKey(e.status))}</Badge>
                </Td>
                <Td>{e.appointment ? formatDateTime(e.appointment.startsAt, locale) : t('listening:reviewOps.engagement.noMeeting')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
