import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Heading, StatusBlock } from '@nestself/ui';
import { joinWindowState } from '@nestself/api-client';
import type { Appointment } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { AppointmentStatusBadge, useCategoryLabel, useExpertLabel } from '../../../calls/appointment-parts';
import { useZonedFormat } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';
import { canJoinConsultations, requireConsultationAccess } from '../../../calls/route-gate';
import { useAppointmentList } from '../../../calls/use-appointments';
import type { AppointmentListState } from '../../../calls/use-appointments';

export const Route = createFileRoute('/_authenticated/appointments/')({
  beforeLoad: ({ context, location }) => requireConsultationAccess(context.auth, location.pathname),
  component: AppointmentsPage,
});

const ACTIVE_STATUSES: ReadonlySet<Appointment['status']> = new Set(['proposed', 'awaiting_approval', 'confirmed']);

/** Upcoming: still to happen or still joinable, soonest first. Past: everything else, latest first. */
function split(items: readonly Appointment[], now: number) {
  const upcoming: Appointment[] = [];
  const past: Appointment[] = [];
  for (const appointment of items) {
    const active = ACTIVE_STATUSES.has(appointment.status) && joinWindowState({ ...appointment, status: 'confirmed' }, now).kind !== 'closed';
    (active ? upcoming : past).push(appointment);
  }
  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  past.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { upcoming, past };
}

function AppointmentRow({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const categoryLabel = useCategoryLabel();
  const expertLabel = useExpertLabel();
  const date = format.date(appointment.startsAt, appointment.timeZone);
  const time = format.time(appointment.startsAt, appointment.timeZone);
  const expert = expertLabel(appointment);
  return (
    <Card as="li" interactive className="relative">
      <div className="gap-3 flex flex-wrap items-start justify-between">
        <div className="gap-1 min-w-0 flex flex-col">
          <Link
            to="/appointments/$appointmentId"
            params={{ appointmentId: appointment.id }}
            className="type-label text-text no-underline after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {t('appointments.dateTime', { date, time })}
          </Link>
          <p className="type-body text-text-secondary">{categoryLabel(appointment.serviceCategory)}</p>
          <p className="type-metadata text-text-secondary">{expert.name ? t('appointments.withExpert', { name: expert.name }) : expert.label}</p>
        </div>
        <AppointmentStatusBadge appointment={appointment} />
      </div>
    </Card>
  );
}

function AppointmentSection({
  id,
  title,
  items,
  list,
}: {
  id: string;
  title: string;
  items: readonly Appointment[];
  /** The query behind the section, for its own "Load more". */
  list: AppointmentListState;
}) {
  const { t } = useTranslation('calls');
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="gap-3 flex flex-col">
      <Heading level={2} typeRole="sectionTitle" id={id}>
        {title}
      </Heading>
      <ul className="gap-3 m-0 p-0 flex list-none flex-col">
        {items.map((appointment) => (
          <AppointmentRow key={appointment.id} appointment={appointment} />
        ))}
      </ul>
      {list.hasNextPage ? (
        <div>
          <Button variant="secondary" onClick={list.fetchNextPage} loading={list.isFetchingNextPage} loadingLabel={t('appointments.loadingMore')}>
            {t('appointments.loadMore')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function AppointmentsPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  // Read once per visit: a row moving between sections while open would be jarring.
  const [now] = useState(() => Date.now());
  // What is ahead, soonest first; the history, newest first (the API orders both).
  const [since] = useState(() => new Date(now - DAY_MS).toISOString());
  const recent = useAppointmentList({ from: since, order: 'asc' });
  const history = useAppointmentList({ to: since, order: 'desc' });

  if (!canJoinConsultations(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  const fromRecent = split(recent.items, now);
  const upcoming = fromRecent.upcoming;
  const past = [...new Map([...fromRecent.past, ...history.items].map((item) => [item.id, item])).values()].sort(
    (a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt),
  );
  const status = recent.status === 'error' || history.status === 'error' ? 'error' : recent.status === 'pending' || history.status === 'pending' ? 'pending' : 'success';
  const failed = recent.status === 'error' ? recent : history;

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('common:nav.appointments')}
      </Heading>

      {status === 'pending' ? <StatusBlock state="loading" title={t('common:state.loading')} body="" /> : null}

      {status === 'error' ? (
        <StatusBlock
          state="offline"
          title={t('calls:appointments.errorTitle')}
          body={mapCallError(failed.error, tCalls)}
          action={{ label: t('common:action.retry'), onClick: failed.refetch }}
        />
      ) : null}

      {status === 'success' && upcoming.length === 0 && past.length === 0 ? (
        <StatusBlock state="empty" title={t('common:state.empty.title')} body={t('common:state.empty.body')} />
      ) : null}

      <AppointmentSection id="appointments-upcoming" title={t('calls:appointments.upcoming')} items={upcoming} list={recent} />
      <AppointmentSection id="appointments-past" title={t('calls:appointments.past')} items={past} list={history} />
    </div>
  );
}
