/**
 * The conversation lists (metadata only): case, the other participant, when
 * it started and how many messages it holds, with a link to the read-only
 * view. The footer pages with the API cursor; a list is never capped
 * silently.
 */
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { ConversationSummary } from '@nestself/contracts';
import { Alert, Button, Table, Td, Th } from '@nestself/ui';
import { casesErrorKey } from './cases-errors';

export interface ConversationTableProps {
  rows: ConversationSummary[];
  /** `expert`: assigned cases (shows the employee); `participant`: own conversations (shows the expert). */
  view: 'expert' | 'participant';
  hasMore: boolean;
  loadingMore: boolean;
  /** The failed request for the next page, if any. */
  loadMoreError: unknown;
  onLoadMore: () => void;
}

const headerClass = 'bg-tint border-b border-border-subtle';
const cellClass = 'border-b border-border-subtle';
const linkClass =
  'text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus';

export function ConversationTable({
  rows,
  view,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: ConversationTableProps) {
  const { t, i18n } = useTranslation('workspace');
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const ns = view === 'expert' ? 'cases' : 'conversations';

  return (
    <div className="space-y-4">
      <Table caption={t(`workspace:${ns}.caption`)}>
        <thead>
          <tr>
            <Th className={headerClass}>{t('workspace:cases.columns.case')}</Th>
            <Th className={headerClass}>
              {view === 'expert' ? t('workspace:cases.columns.employee') : t('workspace:cases.columns.expert')}
            </Th>
            <Th className={headerClass}>{t('workspace:cases.columns.started')}</Th>
            <Th className={headerClass} numeric>
              {t('workspace:cases.columns.messages')}
            </Th>
            <Th className={headerClass}>{t('workspace:cases.columns.open')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-conversation-id={row.id}>
              <Td className={cellClass}>{row.caseId}</Td>
              <Td className={`${cellClass} type-metadata text-text-secondary`}>
                {view === 'expert' ? row.employeeUserId : row.expertUserId}
              </Td>
              <Td className={`${cellClass} type-metadata text-text-secondary`}>
                <time dateTime={row.createdAt}>{formatDate(row.createdAt, locale)}</time>
              </Td>
              <Td className={cellClass} numeric>
                {row.messageCount}
              </Td>
              <Td className={cellClass}>
                {view === 'expert' ? (
                  <Link
                    to="/cases/$id"
                    params={{ id: row.id }}
                    className={linkClass}
                    aria-label={t('workspace:cases.openFor', { id: row.caseId })}
                  >
                    {t('workspace:cases.open')}
                  </Link>
                ) : (
                  <Link
                    to="/conversations/$id"
                    params={{ id: row.id }}
                    className={linkClass}
                    aria-label={t('workspace:cases.openFor', { id: row.caseId })}
                  >
                    {t('workspace:cases.open')}
                  </Link>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center gap-4">
        <p role="status" className="type-body text-text-secondary">
          {hasMore
            ? t('workspace:cases.paging.showingMore', { shown: rows.length })
            : t('workspace:cases.paging.showing', { shown: rows.length })}
        </p>
        {hasMore ? (
          <Button variant="secondary" size="sm" loading={loadingMore} onClick={onLoadMore}>
            {t('workspace:cases.paging.loadMore')}
          </Button>
        ) : null}
      </div>
      {loadMoreError ? (
        <Alert tone="danger" title={t('workspace:cases.paging.loadMoreFailed')}>
          {t(`workspace:cases.errors.${casesErrorKey(loadMoreError)}`)}
        </Alert>
      ) : null}
    </div>
  );
}
