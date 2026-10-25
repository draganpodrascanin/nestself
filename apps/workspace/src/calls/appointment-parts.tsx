/**
 * Pieces shared by the appointment list, the appointment detail and the
 * call route: status badge, category label, expert label and the join panel
 * (CALL-02, CALL-06, CALL-07). Nothing here imports `@nestself/video`, so
 * the list stays light.
 */
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, buttonClassNames, Button } from '@nestself/ui';
import { CALL_JOIN_WINDOW_BEFORE_MINUTES } from '@nestself/contracts';
import type { Appointment, AppointmentResponse } from '@nestself/contracts';
import { isSampleDataMode } from '../data-source';
import { STATUS_TONE, roomClosesAt, supportAreaOf, useZonedFormat } from './format';
import { sampleFirstName } from './sample';
import { Reveal } from './reveal';
import { TechnicalSupportLink } from './support-contact';
import { useJoinWindow } from './use-join-window';
import type { JoinWindowAppointment } from './use-join-window';

export function AppointmentStatusBadge({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('calls');
  if (appointment.status === 'proposed') return <Badge tone="info">{t('followUp.proposed')}</Badge>;
  return <Badge tone={STATUS_TONE[appointment.status]}>{t(`appointments.status.${appointment.status}`)}</Badge>;
}

export function useCategoryLabel() {
  const { t } = useTranslation(['calls', 'common']);
  return (category: string) => {
    const area = supportAreaOf(category);
    return area ? t(`common:area.${area}`) : t('calls:appointments.categoryOther');
  };
}

/**
 * The expert's first name: from the API response (`expert.firstName`, first
 * names only) or the sample people, otherwise a neutral label.
 */
export function useExpertLabel() {
  const { t } = useTranslation('calls');
  return (appointment: Pick<AppointmentResponse, 'expertUserId' | 'expert'>) => {
    const name = isSampleDataMode ? sampleFirstName(appointment.expertUserId) : (appointment.expert?.firstName ?? null);
    return { name, label: name ?? t('appointments.yourExpert') };
  };
}

/** "Join session" with the join window states of CALL-02, CALL-06 and CALL-07, and "Rejoin" after the first-join window. */
export function JoinPanel({ appointment }: { appointment: JoinWindowAppointment & Pick<Appointment, 'timeZone'> }) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const window = useJoinWindow(appointment);
  if (!window || window.kind === 'not_joinable') return null;
  // Ended for everyone: no Join or Rejoin (viewer.sessionEnded, D-CW-09).
  if (appointment.viewer?.sessionEnded) return <Alert tone="info">{t('consultation.sessionEnded')}</Alert>;

  const sampleDemo =
    isSampleDataMode && window.kind !== 'open' ? (
      <Link to="/call/$appointmentId" params={{ appointmentId: appointment.id }} className="type-body text-primary underline underline-offset-[0.2em]">
        {t('join.sampleDemo')}
      </Link>
    ) : null;

  if (window.kind === 'before') {
    return (
      <div className="gap-3 flex flex-col items-start">
        <Button disabled aria-describedby="join-opens-hint">
          {t('join.comeBackAt', { time: format.time(window.opensAt, appointment.timeZone) })}
        </Button>
        <p id="join-opens-hint" className="type-metadata text-text-secondary">
          {t('join.opensHint', { minutes: CALL_JOIN_WINDOW_BEFORE_MINUTES })}
        </p>
        {sampleDemo}
      </div>
    );
  }

  if (window.kind === 'closed' && window.rejoinable) {
    // After the first-join window: a participant who already joined may rejoin until the room closes (CALL-06).
    return (
      <div className="gap-3 flex flex-col items-start">
        <Link to="/call/$appointmentId" params={{ appointmentId: appointment.id }} className={buttonClassNames({ variant: 'secondary', size: 'md' })}>
          {t('join.rejoin')}
        </Link>
        <p className="type-metadata text-text-secondary">
          {t('join.rejoinHint', { time: format.time(roomClosesAt(appointment), appointment.timeZone) })}
        </p>
      </div>
    );
  }

  if (window.kind === 'closed') {
    return (
      <div className="gap-3 flex flex-col items-start">
        <Alert tone="warning">
          <span className="gap-2 flex flex-col">
            <span>{t('join.windowClosed')}</span>
            <TechnicalSupportLink />
          </span>
        </Alert>
        {sampleDemo}
      </div>
    );
  }

  return (
    <div className="gap-3 flex flex-col items-start">
      <Reveal show={window.late}>
        <Alert tone="info">{t('join.lateJoin', { time: format.time(window.startsAt, appointment.timeZone) })}</Alert>
      </Reveal>
      <Link to="/call/$appointmentId" params={{ appointmentId: appointment.id }} className={buttonClassNames({ variant: 'primary', size: 'md' })}>
        {t('join.button')}
      </Link>
    </div>
  );
}
