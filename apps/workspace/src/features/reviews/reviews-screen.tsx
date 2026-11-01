import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Heading, Skeleton, StatusBlock, Table, Td, Text, Th, buttonClassNames } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { formatDate, formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { useOrgContext } from '../people/use-org-context';
import { ENGAGEMENT_TONE, REQUEST_TONE, engagementStatusKey, requestStatusKey, scopeLabel } from './review-labels';
import { sampleEngagements, sampleReviewRequests } from './sample-reviews';
import { useEngagements, useReviewRequests } from './use-reviews';

export interface ReviewsScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/** Requests and engagements of the organization (spec REV-02, REV-10): status and next step, never a score change. */
export function ReviewsScreen({ listeningApi, sampleMode }: ReviewsScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { principal, effectiveActions } = useAuth();
  const { apiOrgId, switchError } = useOrgContext(sampleMode);
  const requestsQuery = useReviewRequests(listeningApi, apiOrgId);
  const engagementsQuery = useEngagements(listeningApi, apiOrgId);
  const requests = sampleMode ? sampleReviewRequests() : requestsQuery.data?.items;
  const engagements = sampleMode ? sampleEngagements() : engagementsQuery.data?.items;
  const canRequest = sampleMode || (principal ? can(principal, 'workplace_reviews.request', undefined, effectiveActions) : false);
  const dims = (keys: readonly string[]) => keys.map((k) => t(`listening:dimensions.${k}.short`)).join(', ');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Heading level={1}>{t('listening:reviews.title')}</Heading>
          <Text tone="secondary">{t('listening:reviews.lead')}</Text>
        </div>
        {canRequest ? (
          <Link to="/listening/reviews/new" className={buttonClassNames({ variant: 'primary' })}>
            {t('listening:reviews.newRequest')}
          </Link>
        ) : null}
      </div>
      {sampleMode ? <Alert tone="info">{t('listening:reviews.sampleNote')}</Alert> : null}
      {!sampleMode && (switchError || requestsQuery.isError) ? <Alert tone="danger">{t(listeningErrorMessageKey(requestsQuery.error) ?? 'listening:errors.unknown')}</Alert> : null}

      <section aria-labelledby="reviews-requests" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="reviews-requests">
          {t('listening:reviews.requests')}
        </Heading>
        {!requests ? (
          <Skeleton lines={3} label={t('common:state.loading')} />
        ) : requests.length === 0 ? (
          <StatusBlock state="empty" title={t('listening:reviews.empty')} body={t('listening:reviews.emptyBody')} />
        ) : (
          <Table caption={t('listening:reviews.requests')}>
            <thead>
              <tr>
                <Th>{t('listening:reviews.columns.scope')}</Th>
                <Th>{t('listening:reviews.columns.dimensions')}</Th>
                <Th>{t('listening:reviews.columns.status')}</Th>
                <Th>{t('listening:reviews.columns.created')}</Th>
                <Th>{t('listening:reviews.columns.coordinator')}</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link to="/listening/reviews/$requestId" params={{ requestId: r.id }} className="type-label text-primary underline">
                      {scopeLabel(t, r.scopeCohortKey)}
                    </Link>
                  </Td>
                  <Td>{dims(r.dimensionKeys)}</Td>
                  <Td>
                    <Badge tone={REQUEST_TONE[r.status]}>{t(requestStatusKey(r.status))}</Badge>
                  </Td>
                  <Td>{formatDate(r.createdAt, locale)}</Td>
                  <Td>{r.coordinatorFirstName ?? t('listening:reviews.detail.noCoordinator')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="reviews-engagements" className="space-y-3">
        <Heading level={2} typeRole="sectionTitle" id="reviews-engagements">
          {t('listening:reviews.engagements')}
        </Heading>
        {!engagements ? (
          <Skeleton lines={3} label={t('common:state.loading')} />
        ) : engagements.length === 0 ? (
          <Text tone="secondary">{t('listening:reviews.empty')}</Text>
        ) : (
          <Table caption={t('listening:reviews.engagements')}>
            <thead>
              <tr>
                <Th>{t('listening:reviews.columns.scope')}</Th>
                <Th>{t('listening:reviews.columns.status')}</Th>
                <Th>{t('listening:reviews.columns.reviewer')}</Th>
                <Th>{t('listening:reviews.columns.meeting')}</Th>
              </tr>
            </thead>
            <tbody>
              {engagements.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <Link to="/listening/reviews/engagements/$engagementId" params={{ engagementId: e.id }} className="type-label text-primary underline">
                      {scopeLabel(t, e.scopeCohortKey)} · {e.scope.title}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={ENGAGEMENT_TONE[e.status]}>{t(engagementStatusKey(e.status))}</Badge>
                  </Td>
                  <Td>{e.reviewerFirstName ?? t('listening:reviews.engagement.noReviewer')}</Td>
                  <Td>{e.appointment ? formatDateTime(e.appointment.startsAt, locale) : t('listening:reviews.engagement.noMeeting')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <Text tone="secondary" typeRole="metadata">
        {t('listening:reviews.engagement.neverChanges')}
      </Text>
    </div>
  );
}
