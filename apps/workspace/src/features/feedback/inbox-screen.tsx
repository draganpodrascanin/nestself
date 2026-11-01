import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Heading, Skeleton, StatusBlock, Table, Td, Text, Th } from '@nestself/ui';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { useOrgContext } from '../people/use-org-context';
import { STATE_TONE, categoryLabel, functionKey, handlerStateKey, kindKey } from './case-labels';
import { sampleFeedbackInbox } from './sample-feedback';
import { useFeedbackInbox } from './use-feedback';

export interface InboxScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/**
 * The handler's inbox (spec FBK-04): the cases assigned to the caller with
 * category, state, next action, due target (overdue first) and the route that
 * brought it. A pseudonym per case, never a reporter.
 */
export function InboxScreen({ listeningApi, sampleMode }: InboxScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { orgId, switchError } = useOrgContext(sampleMode);
  const query = useFeedbackInbox(listeningApi, !sampleMode && orgId !== null);
  const data = sampleMode ? sampleFeedbackInbox() : query.data;
  const items = data ? [...data.items].sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? '').localeCompare(b.dueAt ?? '')) : [];

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:feedback.inbox.title')}</Heading>
      <Text tone="secondary">{t('listening:feedback.inbox.lead')}</Text>
    </div>
  );

  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : null;
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger" title={key ? t(key) : t('listening:errors.unknown')}>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            {t('common:action.retry')}
          </Button>
        </Alert>
      </div>
    );
  }
  if (!data) {
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
      {sampleMode ? <Alert tone="info">{t('listening:feedback.inbox.sampleNote')}</Alert> : null}
      {items.length === 0 ? (
        <StatusBlock state="empty" title={t('listening:feedback.inbox.empty')} body={t('listening:feedback.inbox.lead')} />
      ) : (
        <Table caption={t('listening:feedback.inbox.title')}>
          <thead>
            <tr>
              <Th>{t('listening:feedback.columns.case')}</Th>
              <Th>{t('listening:feedback.columns.kind')}</Th>
              <Th>{t('listening:feedback.columns.category')}</Th>
              <Th>{t('listening:feedback.columns.state')}</Th>
              <Th>{t('listening:feedback.columns.nextAction')}</Th>
              <Th>{t('listening:feedback.columns.due')}</Th>
              <Th>{t('listening:feedback.columns.route')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td>
                  <Link to="/feedback/inbox/$caseId" params={{ caseId: item.id }} className="type-label text-primary underline">
                    {item.pseudonym}
                  </Link>
                </Td>
                <Td>{t(kindKey(item.kind))}</Td>
                <Td>{categoryLabel(t, item.category)}</Td>
                <Td>
                  <Badge tone={STATE_TONE[item.state]}>{t(handlerStateKey(item.state))}</Badge>
                </Td>
                <Td>{item.nextAction ? t(`listening:feedback.nextAction.${item.nextAction}`, { defaultValue: item.nextAction }) : '—'}</Td>
                <Td>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {item.dueAt ? formatDateTime(item.dueAt, locale) : '—'}
                    {item.overdue ? <Badge tone="danger">{t('listening:feedback.inbox.overdue')}</Badge> : null}
                    {item.escalatedAt ? <Badge tone="warning">{t('listening:feedback.inbox.escalated')}</Badge> : null}
                  </span>
                </Td>
                <Td>{t(functionKey(item.routeChoice))}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
