/**
 * Webinar discovery (WBN-01, WBN-02, guidelines 12.1): the published
 * occurrences the server says the employee may attend, never filtered on
 * the client, with title, presenters, schedule, places left and Register.
 * The recording notice sits beside every Register button (D-CW-34).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Heading, StatusBlock } from '@nestself/ui';
import type { WebinarResponse } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { canAttendWebinars, requireWebinarAccess } from '../../../webinars/route-gate';
import { mapWebinarError } from '../../../webinars/map-webinar-error';
import { useWebinarList } from '../../../webinars/use-webinars';
import { PlacesBadge, RecordingNotice, RegistrationAction, WebinarStatusBadge } from '../../../webinars/webinar-parts';
import { useLocalized, useWebinarWhen } from '../../../webinars/webinar-format';

export const Route = createFileRoute('/_authenticated/webinars/')({
  beforeLoad: ({ context, location }) => requireWebinarAccess(context.auth, location.pathname),
  component: WebinarsPage,
});

function WebinarCard({ webinar }: { webinar: WebinarResponse }) {
  const { t } = useTranslation('calls');
  const localized = useLocalized();
  const when = useWebinarWhen();
  const title = localized(webinar.title);
  const names = webinar.presenters.map((presenter) => presenter.displayName).join(', ');
  return (
    <Card as="li" className="gap-3 flex flex-col">
      <div className="gap-3 flex flex-wrap items-start justify-between">
        <div className="gap-1 min-w-0 flex flex-col">
          <Heading level={2} typeRole="sectionTitle">
            <Link to="/webinars/$webinarId" params={{ webinarId: webinar.id }} className="text-text underline-offset-[0.2em] hover:underline">
              {title}
            </Link>
          </Heading>
          <p className="type-body text-text-secondary">{when(webinar)}</p>
          {names ? <p className="type-metadata text-text-secondary">{t('webinar.presenters', { names })}</p> : null}
        </div>
        <div className="gap-2 flex flex-wrap items-center">
          <WebinarStatusBadge status={webinar.status} />
          {webinar.registered ? <span className="type-metadata text-success">{t('webinar.registeredBadge')}</span> : <PlacesBadge webinar={webinar} />}
        </div>
      </div>
      {!webinar.registered && webinar.status === 'published' ? <RecordingNotice /> : null}
      <RegistrationAction webinar={webinar} />
    </Card>
  );
}

function WebinarsPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const list = useWebinarList();

  if (!canAttendWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  return (
    <div className="space-y-6">
      <header className="gap-1 flex flex-col">
        <Heading level={1} typeRole="screenTitle">
          {t('calls:webinar.discovery.title')}
        </Heading>
        <p className="type-body text-text-secondary">{t('calls:webinar.discovery.intro')}</p>
      </header>

      {list.status === 'pending' ? <StatusBlock state="loading" title={t('common:state.loading')} body="" /> : null}

      {list.status === 'error' ? (
        <StatusBlock
          state="offline"
          title={t('calls:webinar.discovery.errorTitle')}
          body={mapWebinarError(list.error, tCalls)}
          action={{ label: t('common:action.retry'), onClick: list.refetch }}
        />
      ) : null}

      {list.status === 'success' && list.items.length === 0 ? (
        <StatusBlock state="empty" title={t('calls:webinar.discovery.emptyTitle')} body={t('calls:webinar.discovery.emptyBody')} />
      ) : null}

      {list.items.length > 0 ? (
        <ul className="gap-3 m-0 p-0 flex list-none flex-col" aria-label={t('calls:webinar.discovery.title')}>
          {list.items.map((webinar) => (
            <WebinarCard key={webinar.id} webinar={webinar} />
          ))}
        </ul>
      ) : null}

      {list.hasNextPage ? (
        <Button variant="secondary" onClick={list.fetchNextPage} loading={list.isFetchingNextPage} loadingLabel={t('calls:webinar.discovery.loadingMore')}>
          {t('calls:webinar.discovery.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
