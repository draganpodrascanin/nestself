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

function AppointmentSection({ id, title, items }: { id: string; title: string; items: readonly Appointment[] }) {
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
    </section>
  );
}

function AppointmentsPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const list = useAppointmentList();
  // Read once per visit: a row moving between sections while open would be jarring.
  const [now] = useState(() => Date.now());

  if (!canJoinConsultations(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  const { upcoming, past } = split(list.items, now);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('common:nav.appointments')}
      </Heading>

      {list.status === 'pending' ? <StatusBlock state="loading" title={t('common:state.loading')} body="" /> : null}

      {list.status === 'error' ? (
        <StatusBlock
          state="offline"
          title={t('calls:appointments.errorTitle')}
          body={mapCallError(list.error, tCalls)}
          action={{ label: t('common:action.retry'), onClick: list.refetch }}
        />
      ) : null}

      {list.status === 'success' && list.items.length === 0 ? (
        <StatusBlock state="empty" title={t('common:state.empty.title')} body={t('common:state.empty.body')} />
      ) : null}

      <AppointmentSection id="appointments-upcoming" title={t('calls:appointments.upcoming')} items={upcoming} />
      <AppointmentSection id="appointments-past" title={t('calls:appointments.past')} items={past} />

      {list.hasNextPage ? (
        <Button variant="secondary" onClick={list.fetchNextPage} loading={list.isFetchingNextPage} loadingLabel={t('calls:appointments.loadingMore')}>
          {t('calls:appointments.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
