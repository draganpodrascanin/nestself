/**
 * Webinar detail and lobby (WBN-01 to WBN-03, WBN-06, guidelines 12.1):
 * title, presenters, schedule in the occurrence's time zone, the recording
 * notice (D-CW-34) with the captions statement (WBN-15, D-CW-23), the
 * registration status with register and cancel, and
 * the lobby: the camera sentence (D-CW-35, UX-28), a countdown, and "Join
 * webinar", enabled from 15 minutes before the start for a registered
 * employee. A canceled webinar shows that it was canceled instead, with no
 * registration status and no Join. No attendee list or name appears here
 * (D-CW-15).
 *
 * The live view (`$webinarId.live.tsx`) is this route's child: when it
 * matches, this route renders only the outlet.
 */
import { createFileRoute, Link, Outlet, useChildMatches, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Heading, StatusBlock } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import type { WebinarResponse } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { useZonedFormat } from '../../../calls/format';
import { canAttendWebinars, requireWebinarAccess } from '../../../webinars/route-gate';
import { mapWebinarError } from '../../../webinars/map-webinar-error';
import { useWebinar } from '../../../webinars/use-webinars';
import { PlacesBadge, RecordingNotice, RegistrationAction, WebinarStatusBadge } from '../../../webinars/webinar-parts';
import { attendeeJoinWindow, useLocalized, useNow, useWebinarWhen } from '../../../webinars/webinar-format';

export const Route = createFileRoute('/_authenticated/webinars/$webinarId')({
  beforeLoad: ({ context, location }) => requireWebinarAccess(context.auth, location.pathname),
  component: WebinarRoute,
});

const DAY_MS = 24 * 60 * 60_000;

/** "1:05:09" below a day; "in 31 days" from a day on. */
function useCountdown() {
  const { t, i18n } = useTranslation('calls');
  const language = i18n.resolvedLanguage ?? i18n.language;
  return (ms: number) => {
    if (ms >= DAY_MS) {
      const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(Math.floor(ms / DAY_MS), 'day');
      return t('webinar.countdownRelative', { relative });
    }
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    const time = hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    return t('webinar.startsIn', { time });
  };
}

function Lobby({ webinar }: { webinar: WebinarResponse }) {
  const { t } = useTranslation('calls');
  const navigate = useNavigate();
  const format = useZonedFormat();
  const countdown = useCountdown();
  const upcoming = webinar.status === 'published' || webinar.status === 'live';
  const now = useNow(upcoming);
  const { opensAt, closesAt } = attendeeJoinWindow(webinar);
  const untilStart = Date.parse(webinar.startsAt) - now;
  const windowOpen = now >= opensAt.getTime() && now <= closesAt.getTime();
  const canJoin = upcoming && webinar.registered && windowOpen;

  if (webinar.status === 'ended') return <Alert tone="info">{t('webinar.ended')}</Alert>;

  let hint: string | null = null;
  if (!webinar.registered) hint = t('webinar.detail.registerToJoin');
  else if (now < opensAt.getTime()) hint = t('webinar.detail.joinOpensAt', { time: format.time(opensAt, webinar.timeZone) });
  else if (now > closesAt.getTime()) hint = t('webinar.detail.closed');

  return (
    <section aria-labelledby="webinar-lobby-title" className="gap-3 p-4 flex flex-col rounded-card border border-border-subtle bg-surface" data-testid="webinar-detail-lobby">
      <Heading level={2} typeRole="sectionTitle" id="webinar-lobby-title">
        {t('webinar.detail.lobbyTitle')}
      </Heading>
      <p className="type-body">{t('webinar.lobby')}</p>
      {webinar.status === 'published' ? (
        <p className="type-body-large font-[var(--font-weight-label)]" data-testid="webinar-detail-countdown">
          {untilStart > 0 ? countdown(untilStart) : t('webinar.startingSoon')}
        </p>
      ) : null}
      <Button
        className="self-start"
        disabled={!canJoin}
        aria-describedby={hint ? 'webinar-join-hint' : undefined}
        onClick={() => void navigate({ to: '/webinars/$webinarId/live', params: { webinarId: webinar.id } })}
      >
        {t('webinar.join')}
      </Button>
      {hint ? (
        <p id="webinar-join-hint" className="type-metadata text-text-secondary">
          {hint}
        </p>
      ) : null}
      {isSampleDataMode ? (
        <Link to="/webinars/$webinarId/live" params={{ webinarId: webinar.id }} className="type-body text-primary underline underline-offset-[0.2em]">
          {t('webinar.detail.sampleDemo')}
        </Link>
      ) : null}
    </section>
  );
}

function WebinarDetail() {
  const { webinarId } = Route.useParams();
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const { status, webinar, error, refetch } = useWebinar(webinarId);
  const localized = useLocalized();
  const when = useWebinarWhen();

  if (!canAttendWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }
  if (status === 'pending') return <StatusBlock state="loading" title={t('common:state.loading')} body="" />;

  const back = (
    <Link to="/webinars" className="type-body text-primary underline underline-offset-[0.2em]">
      {t('calls:webinar.detail.back')}
    </Link>
  );
  const notFound = status === 'success' ? !webinar : error instanceof ApiError && error.status === 404;
  if (notFound || !webinar) {
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <StatusBlock state="permission" title={t('calls:webinar.detail.notFoundTitle')} body={t('calls:errors.notFound')} />
        ) : (
          <StatusBlock
            state="offline"
            title={t('calls:webinar.detail.errorTitle')}
            body={mapWebinarError(error, tCalls)}
            action={{ label: t('common:action.retry'), onClick: refetch }}
          />
        )}
      </div>
    );
  }

  const description = localized(webinar.description);
  const names = webinar.presenters.map((presenter) => presenter.displayName).join(', ');

  return (
    <div className="space-y-6">
      {back}
      <header className="gap-2 flex flex-col">
        <Heading level={1} typeRole="screenTitle">
          {localized(webinar.title)}
        </Heading>
        <div className="gap-2 flex flex-wrap items-center">
          <WebinarStatusBadge status={webinar.status} />
          {webinar.status === 'published' ? <PlacesBadge webinar={webinar} /> : null}
        </div>
        <p className="type-body text-text-secondary">{when(webinar)}</p>
        {names ? <p className="type-body">{t('calls:webinar.presenters', { names })}</p> : null}
      </header>
      {description ? <p className="type-body max-w-2xl">{description}</p> : null}
      {webinar.status === 'canceled' ? (
        // Canceled: the canceled state only, no registration status, recording notice or Join.
        <div data-testid="webinar-detail-canceled">
          <Alert tone="warning" title={t('calls:webinar.detail.canceled')}>
            {t('calls:webinar.detail.canceledBody')}
          </Alert>
        </div>
      ) : (
        <>
          <RecordingNotice />
          {/* WBN-15, D-CW-23: the captions status, beside the recording notice. */}
          <p className="type-body text-text-secondary" data-testid="webinar-captions-statement">
            {t('calls:webinar.captionsStatement')}
          </p>

          <section aria-labelledby="webinar-registration-title" className="gap-3 flex flex-col">
            <Heading level={2} typeRole="sectionTitle" id="webinar-registration-title">
              {t('calls:webinar.detail.registrationTitle')}
            </Heading>
            <p className="type-body" data-testid="webinar-registration-status">
              {webinar.registered ? t('calls:webinar.detail.registered') : t('calls:webinar.detail.notRegistered')}
            </p>
            <RegistrationAction webinar={webinar} allowUnregister />
          </section>

          <Lobby webinar={webinar} />
        </>
      )}
    </div>
  );
}

function WebinarRoute() {
  // The live view is a child route: it replaces the detail entirely.
  const children = useChildMatches();
  return children.length > 0 ? <Outlet /> : <WebinarDetail />;
}
