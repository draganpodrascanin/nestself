/**
 * The operations webinar list (guidelines 12.2, WBN-30 to WBN-33): every
 * occurrence the caller may manage or moderate (`GET /ops/webinars`), with
 * status, schedule and capacity, and "New webinar" for `event.manage`.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, StatusBlock, Table, Td, Th } from '@nestself/ui';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { canListWebinars, canManageWebinars, requireWebinarList } from '../../../webinars/route-gate';
import { mapWebinarError } from '../../../webinars/map-webinar-error';
import { useOccurrenceList } from '../../../webinars/use-webinars';
import { useLocalized, useWebinarWhen } from '../../../webinars/webinar-format';
import { WebinarStatusBadge } from '../../../webinars/webinar-parts';

export const Route = createFileRoute('/_authenticated/webinars/')({
  beforeLoad: ({ context }) => requireWebinarList(context.auth),
  component: WebinarsAdminPage,
});

function WebinarsAdminPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const list = useOccurrenceList();
  const localized = useLocalized();
  const when = useWebinarWhen();

  if (!canListWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  return (
    <div className="space-y-6">
      <header className="gap-3 flex flex-wrap items-end justify-between">
        <div className="gap-1 flex flex-col">
          <Heading level={1} typeRole="screenTitle">
            {t('calls:webinar.admin.title')}
          </Heading>
          <p className="type-body text-text-secondary">{t('calls:webinar.admin.intro')}</p>
        </div>
        {canManageWebinars(principal, effectiveActions) ? (
          <Link to="/webinars/new" className="min-h-11 px-5 py-2.5 inline-flex items-center rounded-control bg-primary text-on-primary font-[var(--font-weight-label)] no-underline hover:bg-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus">
            {t('calls:webinar.admin.new')}
          </Link>
        ) : null}
      </header>

      {isSampleDataMode ? <Alert tone="info">{t('calls:webinar.admin.sampleNotice')}</Alert> : null}

      {list.status === 'pending' ? <StatusBlock state="loading" title={t('common:state.loading')} body="" /> : null}
      {list.status === 'error' ? (
        <StatusBlock
          state="offline"
          title={t('calls:webinar.admin.errorTitle')}
          body={mapWebinarError(list.error, tCalls)}
          action={{ label: t('common:action.retry'), onClick: list.refetch }}
        />
      ) : null}
      {list.status === 'success' && list.items.length === 0 ? (
        <StatusBlock state="empty" title={t('calls:webinar.admin.emptyTitle')} body={t('calls:webinar.admin.emptyBody')} />
      ) : null}

      {list.items.length > 0 ? (
        <Table caption={t('calls:webinar.admin.title')}>
          <thead>
            <tr>
              <Th>{t('calls:webinar.admin.columns.title')}</Th>
              <Th>{t('calls:webinar.admin.columns.when')}</Th>
              <Th>{t('calls:webinar.admin.columns.status')}</Th>
              <Th numeric>{t('calls:webinar.admin.columns.capacity')}</Th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((webinar) => (
              <tr key={webinar.id}>
                <Td>
                  <Link to="/webinars/$webinarId" params={{ webinarId: webinar.id }} className="text-primary underline underline-offset-[0.2em]">
                    {localized(webinar.title)}
                  </Link>
                </Td>
                <Td>{when(webinar)}</Td>
                <Td>
                  <WebinarStatusBadge status={webinar.status} />
                </Td>
                <Td numeric>{webinar.capacity}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {list.hasNextPage ? (
        <Button variant="secondary" onClick={list.fetchNextPage} loading={list.isFetchingNextPage} loadingLabel={t('calls:webinar.discovery.loadingMore')}>
          {t('calls:webinar.admin.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
