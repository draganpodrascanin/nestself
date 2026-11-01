import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Heading, Skeleton, StatusBlock, Table, Td, Text, Th, buttonClassNames } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { STATE_TONE, categoryLabel, kindKey, reporterStateKey } from './case-labels';
import { sampleMyFeedbackCases } from './sample-feedback';
import { useMyFeedbackCases } from './use-feedback';

export interface MyFeedbackScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/** The reporter's own cases (spec FBK-02): pseudonym, kind, category, state and the last message; nothing of anyone else's. */
export function MyFeedbackScreen({ listeningApi, sampleMode }: MyFeedbackScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const query = useMyFeedbackCases(listeningApi, !sampleMode);
  const data = sampleMode ? sampleMyFeedbackCases() : query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Heading level={1}>{t('listening:feedback.title')}</Heading>
          <Text tone="secondary">{t('listening:feedback.lead')}</Text>
        </div>
        <Link to="/feedback/new" className={buttonClassNames({ variant: 'primary' })}>
          {t('listening:feedback.new')}
        </Link>
      </div>
      {!sampleMode && query.isError ? (
        <Alert tone="danger">{t(listeningErrorMessageKey(query.error) ?? 'listening:errors.unknown')}</Alert>
      ) : !data ? (
        <Skeleton lines={4} label={t('common:state.loading')} />
      ) : data.items.length === 0 ? (
        <StatusBlock state="empty" title={t('listening:feedback.empty')} body={t('listening:feedback.emptyBody')} />
      ) : (
        <Table caption={t('listening:feedback.title')}>
          <thead>
            <tr>
              <Th>{t('listening:feedback.columns.case')}</Th>
              <Th>{t('listening:feedback.columns.kind')}</Th>
              <Th>{t('listening:feedback.columns.category')}</Th>
              <Th>{t('listening:feedback.columns.state')}</Th>
              <Th>{t('listening:feedback.columns.created')}</Th>
              <Th>{t('listening:feedback.columns.lastMessage')}</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id}>
                <Td>
                  <Link to="/feedback/$caseId" params={{ caseId: item.id }} className="type-label text-primary underline">
                    {item.pseudonym}
                  </Link>
                </Td>
                <Td>{t(kindKey(item.kind))}</Td>
                <Td>{categoryLabel(t, item.category)}</Td>
                <Td>
                  <Badge tone={STATE_TONE[item.state]}>{t(reporterStateKey(item.state))}</Badge>
                </Td>
                <Td>{formatDate(item.createdAt, locale)}</Td>
                <Td>{item.lastMessageAt ? formatDate(item.lastMessageAt, locale) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
