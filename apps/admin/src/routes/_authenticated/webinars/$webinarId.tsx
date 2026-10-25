/**
 * One occurrence for operations (WBN-30 to WBN-33): title, schedule in the
 * occurrence's time zone, audience, capacity, presenters and moderator;
 * Publish (draft to published, WBN-31) and Cancel (WBN-32), each confirmed
 * first, for `event.manage`; the live view for hosts; and, once the webinar
 * ran, the attendance counts (never names, D-CW-30).
 *
 * The live view (`$webinarId.live.tsx`) is this route's child: when it
 * matches, this route renders only the outlet.
 */
import { useState } from 'react';
import { createFileRoute, Link, Outlet, useChildMatches } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDialog, AlertDialogContent, AlertDialogTrigger, Button, Heading, StatusBlock } from '@nestself/ui';
import { ApiError, webinarKeys } from '@nestself/api-client';
import type { Webinar, WebinarAudiencePolicy } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { Reveal } from '../../../calls/reveal';
import { canHostWebinars, canListWebinars, canManageWebinars, requireWebinarListOrHost } from '../../../webinars/route-gate';
import { mapWebinarError } from '../../../webinars/map-webinar-error';
import { useAttendance, useOccurrence } from '../../../webinars/use-webinars';
import { useLocalized, useWebinarWhen } from '../../../webinars/webinar-format';
import { WebinarStatusBadge } from '../../../webinars/webinar-parts';
import { webinarsApi } from '../../../webinars/webinars-api';

export const Route = createFileRoute('/_authenticated/webinars/$webinarId')({
  validateSearch: (search: Record<string, unknown>): { created?: boolean } =>
    search.created === true || search.created === 'true' ? { created: true } : {},
  beforeLoad: ({ context }) => requireWebinarListOrHost(context.auth),
  component: WebinarAdminRoute,
});

type Outcome = { tone: 'success' | 'info' | 'danger'; message: string } | null;

function useAudienceLabel() {
  const { t } = useTranslation('calls');
  return (policy: WebinarAudiencePolicy) => {
    if (policy.type === 'all_eligible') return t('webinar.admin.audienceAll');
    if (policy.type === 'organization') return t('webinar.admin.audienceOrganizations', { ids: policy.orgIds.join(', ') });
    return t('webinar.admin.audienceUnits', { orgId: policy.orgId, ids: policy.orgUnitIds.join(', ') });
  };
}

/** Publish and cancel, each confirmed; every outcome is on screen. */
function Actions({ webinar }: { webinar: Webinar }) {
  const { t } = useTranslation('calls');
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<'publish' | 'cancel' | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const run = async (kind: 'publish' | 'cancel') => {
    setOutcome(null);
    if (isSampleDataMode) {
      setOutcome({ tone: 'info', message: t('sample.actionNoop') });
      return;
    }
    setPending(kind);
    try {
      if (kind === 'publish') await webinarsApi.publish(webinar.id);
      else await webinarsApi.cancel(webinar.id);
      setOutcome({ tone: 'success', message: t(kind === 'publish' ? 'webinar.admin.published' : 'webinar.admin.canceled') });
      await queryClient.invalidateQueries({ queryKey: webinarKeys.all });
    } catch (err) {
      // Publishing checks the presenters, the moderator, a future start and the audience (WBN-31).
      const incomplete = kind === 'publish' && err instanceof ApiError && err.code === 'validation';
      setOutcome({ tone: 'danger', message: incomplete ? t('webinar.admin.publishNeeds') : mapWebinarError(err, t) });
    } finally {
      setPending(null);
    }
  };

  const canPublish = webinar.status === 'draft';
  const canCancel = webinar.status === 'draft' || webinar.status === 'published';
  if (!canPublish && !canCancel && !outcome) return null;

  return (
    <div className="gap-3 flex flex-col">
      <div className="gap-3 flex flex-wrap">
        {canPublish ? (
          <AlertDialog>
            <AlertDialogTrigger>
              <Button loading={pending === 'publish'} loadingLabel={t('webinar.admin.publishing')}>
                {t('webinar.admin.publish')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              title={t('webinar.admin.publishTitle')}
              description={t('webinar.admin.publishBody')}
              confirmLabel={t('webinar.admin.publish')}
              cancelLabel={t('webinar.form.cancel')}
              confirmPending={pending === 'publish'}
              onConfirm={() => void run('publish')}
            />
          </AlertDialog>
        ) : null}
        {canCancel ? (
          <AlertDialog>
            <AlertDialogTrigger>
              <Button variant="secondary" loading={pending === 'cancel'} loadingLabel={t('webinar.admin.canceling')}>
                {t('webinar.admin.cancel')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              title={t('webinar.admin.cancelTitle')}
              description={t('webinar.admin.cancelBody')}
              confirmLabel={t('webinar.admin.cancel')}
              cancelLabel={t('webinar.admin.keep')}
              destructive
              confirmPending={pending === 'cancel'}
              onConfirm={() => void run('cancel')}
            />
          </AlertDialog>
        ) : null}
      </div>
      <Reveal show={outcome !== null}>
        <Alert tone={outcome?.tone ?? 'info'}>{outcome?.message}</Alert>
      </Reveal>
    </div>
  );
}

function Attendance({ webinar }: { webinar: Webinar }) {
  const { t } = useTranslation('calls');
  const ran = webinar.status === 'live' || webinar.status === 'ended';
  const { status, attendance, error } = useAttendance(webinar.id, ran);
  if (!ran) return null;
  return (
    <section aria-labelledby="webinar-attendance-title" className="gap-2 flex flex-col">
      <Heading level={2} typeRole="sectionTitle" id="webinar-attendance-title">
        {t('webinar.admin.attendanceTitle')}
      </Heading>
      {status === 'error' ? (
        <Alert tone="danger" title={t('webinar.admin.attendanceErrorTitle')}>
          {mapWebinarError(error, t)}
        </Alert>
      ) : null}
      {attendance ? (
        <ul className="gap-1 m-0 p-0 flex list-none flex-col type-body" data-testid="webinar-attendance">
          <li>{t('webinar.admin.registeredCount', { count: attendance.registeredCount })}</li>
          <li>{t('webinar.admin.joinedCount', { count: attendance.joinedCount })}</li>
          <li>{t('webinar.admin.peakCount', { count: attendance.peakConcurrent })}</li>
        </ul>
      ) : null}
    </section>
  );
}

function WebinarAdminDetail() {
  const { webinarId } = Route.useParams();
  const { created } = Route.useSearch();
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const { status, webinar, error, refetch } = useOccurrence(webinarId);
  const localized = useLocalized();
  const when = useWebinarWhen();
  const audienceLabel = useAudienceLabel();

  if (!canListWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }
  if (status === 'pending') return <StatusBlock state="loading" title={t('common:state.loading')} body="" />;

  const back = (
    <Link to="/webinars" className="type-body text-primary underline underline-offset-[0.2em]">
      {t('calls:webinar.admin.back')}
    </Link>
  );
  const notFound = status === 'success' ? !webinar : error instanceof ApiError && error.status === 404;
  if (notFound || !webinar) {
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <StatusBlock state="permission" title={t('calls:webinar.admin.notFoundTitle')} body={t('calls:errors.notFound')} />
        ) : (
          <StatusBlock
            state="offline"
            title={t('calls:webinar.admin.errorTitle')}
            body={mapWebinarError(error, tCalls)}
            action={{ label: t('common:action.retry'), onClick: refetch }}
          />
        )}
      </div>
    );
  }

  const presenters = webinar.hosts.filter((host) => host.role === 'presenter').map((host) => host.displayName);
  const moderator = webinar.hosts.find((host) => host.role === 'moderator')?.displayName;
  const description = localized(webinar.description);
  const live = (webinar.status === 'published' || webinar.status === 'live') && canHostWebinars(principal, effectiveActions);
  const facts: [string, string][] = [
    [t('calls:webinar.admin.facts.when'), when(webinar)],
    [t('calls:webinar.admin.facts.audience'), audienceLabel(webinar.audiencePolicy)],
    [t('calls:webinar.admin.facts.capacity'), t('calls:webinar.admin.capacityValue', { capacity: webinar.capacity })],
    [t('calls:webinar.admin.facts.presenters'), presenters.length > 0 ? presenters.join(', ') : t('calls:webinar.admin.notAssigned')],
    [t('calls:webinar.admin.facts.moderator'), moderator ?? t('calls:webinar.admin.notAssigned')],
  ];

  return (
    <div className="space-y-6">
      {back}
      <header className="gap-2 flex flex-col">
        <Heading level={1} typeRole="screenTitle">
          {localized(webinar.title)}
        </Heading>
        <div>
          <WebinarStatusBadge status={webinar.status} />
        </div>
      </header>
      {isSampleDataMode ? <Alert tone="info">{t('calls:webinar.admin.sampleNotice')}</Alert> : null}
      {created ? <Alert tone="success">{t('calls:webinar.admin.created')}</Alert> : null}

      <dl className="gap-x-6 gap-y-3 m-0 grid grid-cols-1 sm:grid-cols-[max-content_1fr]">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="type-label text-text-secondary">{term}</dt>
            <dd className="m-0 type-body">{value}</dd>
          </div>
        ))}
      </dl>
      {description ? <p className="type-body max-w-2xl">{description}</p> : null}
      <p className="p-3 rounded-control bg-info-surface text-info type-body">{t('calls:webinar.recordingNotice')}</p>

      {canManageWebinars(principal, effectiveActions) ? <Actions webinar={webinar} /> : null}

      {live ? (
        <Link to="/webinars/$webinarId/live" params={{ webinarId: webinar.id }} className="type-body text-primary underline underline-offset-[0.2em]">
          {t('calls:webinar.admin.openLive')}
        </Link>
      ) : null}

      <Attendance webinar={webinar} />
    </div>
  );
}

function WebinarAdminRoute() {
  // The live view is a child route: it replaces the detail entirely.
  const children = useChildMatches();
  return children.length > 0 ? <Outlet /> : <WebinarAdminDetail />;
}
