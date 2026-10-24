import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Card, Heading, StatusBlock } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import type { Appointment } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { AppointmentStatusBadge, JoinPanel, useCategoryLabel, useExpertLabel } from '../../../calls/appointment-parts';
import { EmployeeFollowUpPanel, followUpOf } from '../../../calls/follow-up-panel';
import { useZonedFormat } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';
import { canJoinConsultations, requireConsultationAccess } from '../../../calls/route-gate';
import { useAppointment } from '../../../calls/use-appointments';

export const Route = createFileRoute('/_authenticated/appointments/$appointmentId')({
  beforeLoad: ({ context, location }) => requireConsultationAccess(context.auth, location.pathname),
  component: AppointmentDetailPage,
});

function AppointmentDetails({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const expertLabel = useExpertLabel();
  const categoryLabel = useCategoryLabel();
  const rows = [
    { term: t('appointments.details.expert'), description: expertLabel(appointment).label },
    { term: t('appointments.details.date'), description: format.date(appointment.startsAt, appointment.timeZone) },
    {
      term: t('appointments.details.time'),
      description: `${format.time(appointment.startsAt, appointment.timeZone)} – ${format.time(appointment.endsAt, appointment.timeZone)}`,
    },
    { term: t('appointments.details.category'), description: categoryLabel(appointment.serviceCategory) },
  ];
  return (
    <Card>
      <dl className="gap-x-6 gap-y-3 m-0 grid sm:grid-cols-[max-content_1fr]">
        {rows.map((row) => (
          <div key={row.term} className="contents">
            <dt className="type-label text-text-secondary">{row.term}</dt>
            <dd className="m-0 type-body text-text">{row.description}</dd>
          </div>
        ))}
        <div className="contents">
          <dt className="type-label text-text-secondary">{t('appointments.details.status')}</dt>
          <dd className="m-0">
            <AppointmentStatusBadge appointment={appointment} />
          </dd>
        </div>
      </dl>
      <p className="mt-4 type-metadata text-text-secondary">{t('followUp.timeZoneNote', { timeZone: appointment.timeZone })}</p>
    </Card>
  );
}

function AppointmentDetailPage() {
  const { appointmentId } = Route.useParams();
  const { t } = useTranslation('calls');
  const { t: tCommon } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  const { status, appointment, error, refetch } = useAppointment(appointmentId);
  const categoryLabel = useCategoryLabel();

  if (!canJoinConsultations(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={tCommon('state.permission.title')} body={tCommon('state.permission.body')} />;
  }

  const back = (
    <Link to="/appointments" className="type-body text-primary underline underline-offset-[0.2em]">
      {t('appointments.back')}
    </Link>
  );

  if (status === 'pending') return <StatusBlock state="loading" title={tCommon('state.loading')} body="" />;

  const notFound = status === 'success' ? !appointment : error instanceof ApiError && error.status === 404;
  if (notFound || !appointment) {
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <StatusBlock state="permission" title={t('appointments.notFoundTitle')} body={t('appointments.notFoundBody')} />
        ) : (
          <StatusBlock
            state="offline"
            title={t('appointments.errorTitle')}
            body={mapCallError(error, t)}
            action={{ label: tCommon('action.retry'), onClick: refetch }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}
      <Heading level={1} typeRole="screenTitle">
        {categoryLabel(appointment.serviceCategory)}
      </Heading>
      <AppointmentDetails appointment={appointment} />
      <JoinPanel appointment={appointment} />
      <EmployeeFollowUpPanel key={appointment.id} {...followUpOf(appointment)} />
    </div>
  );
}
