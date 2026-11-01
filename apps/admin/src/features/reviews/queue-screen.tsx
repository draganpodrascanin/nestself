import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Heading, Skeleton, StatusBlock, Table, Td, Text, Th } from '@nestself/ui';
import { ACTIVE_REVIEW_REQUEST_STATUSES } from '@nestself/contracts';
import type { ReviewQueueItem } from '@nestself/contracts';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { REQUEST_TONE, requestStatusKey, scopeLabel } from './review-labels';
import { sampleQueue } from './sample-reviews-ops';
import { useOperationsContext, useReviewQueue } from './use-reviews-ops';

export interface QueueScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/**
 * The coordinator's queue (spec REV-03, OPS-02): every request with its
 * organization, scope, safe metadata, status, owner and response target.
 * Never a raw answer, a feedback case or a score.
 */
export function QueueScreen({ listeningApi, sampleMode }: QueueScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const query = useReviewQueue(listeningApi, ready);
  const items: ReviewQueueItem[] | undefined = sampleMode ? sampleQueue() : query.data?.items;

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:reviewOps.queue.title')}</Heading>
      <Text tone="secondary">{t('listening:reviewOps.queue.lead')}</Text>
    </div>
  );
  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : null;
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{key ? t(key) : t('listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={5} label={t('common:state.loading')} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:reviewOps.queue.sampleNote')}</Alert> : null}
      {items.length === 0 ? (
        <StatusBlock state="empty" title={t('listening:reviewOps.queue.empty')} body={t('listening:reviewOps.queue.lead')} />
      ) : (
        <Table caption={t('listening:reviewOps.queue.title')}>
          <thead>
            <tr>
              <Th>{t('listening:reviewOps.queue.columns.organization')}</Th>
              <Th>{t('listening:reviewOps.queue.columns.scope')}</Th>
              <Th>{t('listening:reviewOps.queue.columns.dimensions')}</Th>
              <Th>{t('listening:reviewOps.queue.columns.status')}</Th>
              <Th>{t('listening:reviewOps.queue.columns.requester')}</Th>
              <Th>{t('listening:reviewOps.queue.columns.coordinator')}</Th>
              <Th>{t('listening:reviewOps.queue.columns.created')}</Th>
              <Th>{t('listening:reviewOps.queue.columns.due')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const active = ACTIVE_REVIEW_REQUEST_STATUSES.includes(item.status);
              return (
                <tr key={item.id}>
                  <Td>
                    <Link to="/workplace-reviews/$requestId" params={{ requestId: item.id }} className="type-label text-primary underline">
                      {item.organizationName}
                    </Link>
                  </Td>
                  <Td>{scopeLabel(t, item.scopeCohortKey)}</Td>
                  <Td>{item.dimensionKeys.map((k) => t(`listening:dimensions.${k}.short`)).join(', ')}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={REQUEST_TONE[item.status]}>{t(requestStatusKey(item.status))}</Badge>
                      {active && item.overdue ? <Badge tone="danger">{t('listening:reviewOps.queue.overdue')}</Badge> : null}
                      {active && !item.coordinatorUserId ? <Badge tone="warning">{t('listening:reviewOps.queue.unassigned')}</Badge> : null}
                    </div>
                  </Td>
                  <Td>{item.requesterFirstName ?? '—'}</Td>
                  <Td>{item.coordinatorFirstName ?? '—'}</Td>
                  <Td>{formatDate(item.createdAt, locale)}</Td>
                  <Td>{formatDate(item.dueAt, locale)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
