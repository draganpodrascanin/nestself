/**
 * The expert's consultation page (guidelines 12.2, CALL-18 to CALL-23,
 * CALL-34, D-CW-37): participants, time, status and outcome; the running-late
 * signal and Join inside the join window; the call itself in place; after
 * the call, the outcome dialog (enum only) and, once the outcome is
 * `completed`, the follow-up proposal card. On a follow-up the expert
 * proposed, the employee's suggested windows to schedule one (CALL-37).
 */
import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, Heading, Select, StatusBlock } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import { can } from '@nestself/contracts';
import type { Appointment, CallOutcomeStatus } from '@nestself/contracts';
import type { AppointmentView } from '@nestself/api-client';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { callsApi } from '../../../calls/calls-api';
import { ExpertCall } from '../../../calls/expert-call';
import { ExpertFollowUp, ScheduleFollowUpCard } from '../../../calls/expert-follow-up';
import type { ExpertCallEnd } from '../../../calls/expert-call';
import { STATUS_TONE, outcomeColumn, roomClosesAt, useCategoryLabel, useZonedFormat } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';
import { CancelAppointment } from '../../../calls/cancel-appointment';
import { OutcomeDialog } from '../../../calls/outcome-dialog';
import { TechnicalSupportLink } from '../../../calls/support-contact';
import { Reveal } from '../../../calls/reveal';
import { canListConsultations, isConsultingExpert, requireConsultationList } from '../../../calls/route-gate';
import { sampleFirstName } from '../../../calls/sample';
import { useConsultation } from '../../../calls/use-consultations';
import { useJoinWindow } from '../../../calls/use-join-window';

export const Route = createFileRoute('/_authenticated/consultations/$appointmentId')({
  beforeLoad: ({ context }) => requireConsultationList(context.auth),
  component: ConsultationRoute,
});

const RUNNING_LATE_ETAS = ['5', '10', '15'] as const;

function RunningLate({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('calls');
  const [eta, setEta] = useState<string>(RUNNING_LATE_ETAS[0]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'info' | 'danger'; message: string } | null>(null);

  const send = async () => {
    setResult(null);
    if (isSampleDataMode) {
      setResult({ tone: 'info', message: t('sample.actionNoop') });
      return;
    }
    setPending(true);
    try {
      await callsApi.sendSignal(appointment.id, { type: 'running_late', etaMinutes: Number(eta) });
      setResult({ tone: 'success', message: t('consultations.runningLateSent') });
    } catch (err) {
      setResult({ tone: 'danger', message: mapCallError(err, t) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gap-3 flex flex-col">
      <div className="gap-3 flex flex-wrap items-end">
        <Field label={t('consultations.runningLateEta')} className="min-w-40">
          <Select
            options={RUNNING_LATE_ETAS.map((value) => ({ value, label: t('followUp.durationOption', { count: Number(value) }) }))}
            value={eta}
            onValueChange={(value) => value && setEta(value)}
          />
        </Field>
        <Button variant="secondary" onClick={() => void send()} loading={pending} loadingLabel={t('consultations.runningLate')}>
          {t('consultations.runningLate')}
        </Button>
      </div>
      <Reveal show={result !== null}>
        <Alert tone={result?.tone ?? 'info'}>{result?.message}</Alert>
      </Reveal>
    </div>
  );
}

/**
 * CALL-27: in the admin app, client operations cancel through `bookings.coordinate`
 * (queue-scoped coordinators cannot; the API's service decides either way).
 */
function canCancel(principal: Parameters<typeof can>[0] | null, effectiveActions: readonly string[]): boolean {
  return !!principal && can(principal, 'bookings.coordinate', undefined, effectiveActions);
}

function ConsultationRoute() {
  const { principal, effectiveActions } = useAuth();
  const { t } = useTranslation('common');
  if (isConsultingExpert(principal, effectiveActions)) return <ConsultationPage />;
  if (canListConsultations(principal, effectiveActions)) return <OperationsConsultationView />;
  return <StatusBlock state="permission" title={t('state.permission.title')} body={t('state.permission.body')} />;
}

/**
 * Operations' read-only view of one consultation (CALL-28): who, when, the
 * status and the outcome, from the row the list loaded (operations cannot
 * read the expert's detail route), and Cancel for coordinators (CALL-27).
 */
function OperationsConsultationView() {
  const { appointmentId } = Route.useParams();
  const { t } = useTranslation('calls');
  const { t: tCommon } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  const { status, appointment: loaded, error, refetch } = useConsultation(appointmentId, { fromListOnly: true });
  const [canceled, setCanceled] = useState<Appointment | null>(null);
  const format = useZonedFormat();
  const categoryLabel = useCategoryLabel();
  const [now] = useState(() => Date.now());

  const back = (
    <Link to="/consultations" className="text-primary underline underline-offset-[0.2em]">
      {t('consultations.back')}
    </Link>
  );
  if (status === 'pending') return <StatusBlock state="loading" title={tCommon('state.loading')} body="" />;
  if (!loaded) {
    const notFound = status === 'success' || (error instanceof ApiError && error.status === 404);
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <StatusBlock state="permission" title={t('appointments.notFoundTitle')} body={t('appointments.notFoundBody')} />
        ) : (
          <StatusBlock state="offline" title={t('consultations.errorTitle')} body={mapCallError(error, t)} action={{ label: tCommon('action.retry'), onClick: refetch }} />
        )}
      </div>
    );
  }
  const appointment: AppointmentView = canceled ? { ...loaded, ...canceled } : loaded;
  const name = (who: 'employee' | 'expert') =>
    isSampleDataMode ? sampleFirstName(who === 'employee' ? appointment.employeeUserId : appointment.expertUserId) : (appointment[who]?.firstName ?? null);
  const rows = [
    { term: t('consultations.columns.employee'), description: name('employee') ?? t('consultations.employeeFallback') },
    { term: t('consultations.columns.expert'), description: name('expert') ?? t('appointments.yourExpert') },
    { term: t('consultations.columns.organisation'), description: appointment.orgId },
    { term: t('appointments.details.category'), description: categoryLabel(appointment.serviceCategory) },
    { term: t('appointments.details.date'), description: format.date(appointment.startsAt, appointment.timeZone) },
    {
      term: t('appointments.details.time'),
      description: `${format.time(appointment.startsAt, appointment.timeZone)} – ${format.time(appointment.endsAt, appointment.timeZone)}`,
    },
    { term: t('consultations.columns.outcome'), description: t(`consultations.outcomeColumn.${outcomeColumn(appointment, now)}`) },
  ];

  return (
    <div className="space-y-6">
      {back}
      <Heading level={1}>{categoryLabel(appointment.serviceCategory)}</Heading>
      <Alert tone="info">{t('consultations.readOnly')}</Alert>
      <Card>
        <dl className="gap-x-6 gap-y-3 m-0 grid sm:grid-cols-[max-content_1fr]">
          {rows.map((row) => (
            <div key={row.term} className="contents">
              <dt className="type-label text-text-secondary">{row.term}</dt>
              <dd className="m-0 text-text">{row.description}</dd>
            </div>
          ))}
          <div className="contents">
            <dt className="type-label text-text-secondary">{t('appointments.details.status')}</dt>
            <dd className="m-0">
              <Badge tone={STATUS_TONE[appointment.status]}>{t(`appointments.status.${appointment.status}`)}</Badge>
            </dd>
          </div>
        </dl>
        <p className="mt-4 type-metadata text-text-secondary">{t('followUp.timeZoneNote', { timeZone: appointment.timeZone })}</p>
      </Card>
      {canCancel(principal, effectiveActions) ? <CancelAppointment appointment={appointment} onCanceled={setCanceled} /> : null}
    </div>
  );
}

function ConsultationPage() {
  const { appointmentId } = Route.useParams();
  const { t } = useTranslation('calls');
  const { t: tCommon } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  const { status, appointment, error, refetch } = useConsultation(appointmentId);
  const format = useZonedFormat();
  const categoryLabel = useCategoryLabel();
  const window = useJoinWindow(appointment);
  const [inCall, setInCall] = useState(false);
  const [ended, setEnded] = useState<ExpertCallEnd | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [recorded, setRecorded] = useState<CallOutcomeStatus | null>(null);
  const [now] = useState(() => Date.now());

  const permission = <StatusBlock state="permission" title={tCommon('state.permission.title')} body={tCommon('state.permission.body')} />;
  if (!isConsultingExpert(principal, effectiveActions)) return permission;

  const back = (
    <Link to="/consultations" className="text-primary underline underline-offset-[0.2em]">
      {t('consultations.back')}
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
          <StatusBlock state="offline" title={t('consultations.errorTitle')} body={mapCallError(error, t)} action={{ label: tCommon('action.retry'), onClick: refetch }} />
        )}
      </div>
    );
  }
  if (appointment.expertUserId !== principal?.userId) return permission;

  const employeeName = isSampleDataMode ? sampleFirstName(appointment.employeeUserId) : (appointment.employee?.firstName ?? null);
  const expertName = principal.displayName.split(' ')[0] ?? principal.displayName;
  const outcome = recorded ? (recorded === 'completed' ? 'completed' : recorded === 'canceled' || recorded === 'technical_failure' ? 'canceled' : 'no_show') : outcomeColumn(appointment, now);
  const canRecordOutcome = !recorded && appointment.status === 'confirmed' && (ended !== null || Date.parse(appointment.startsAt) <= now);
  const showFollowUp = recorded === 'completed' || (!recorded && appointment.status === 'completed');
  // After "End for everyone" the page is the post-call state: no Join or Rejoin (the server refuses both, D-CW-09).
  const joinable = !recorded && ended !== 'ended';

  const onCallEnded = (how: ExpertCallEnd) => {
    setInCall(false);
    setEnded(how);
    // CALL-21: ending the session leads straight to the outcome capture.
    if (how === 'ended') setOutcomeOpen(true);
  };

  const rows = [
    { term: t('consultations.columns.employee'), description: employeeName ?? t('consultations.employeeFallback') },
    { term: t('appointments.details.expert'), description: t('consultations.you', { name: expertName }) },
    { term: t('appointments.details.date'), description: format.date(appointment.startsAt, appointment.timeZone) },
    {
      term: t('appointments.details.time'),
      description: `${format.time(appointment.startsAt, appointment.timeZone)} – ${format.time(appointment.endsAt, appointment.timeZone)}`,
    },
    { term: t('consultations.columns.outcome'), description: t(`consultations.outcomeColumn.${outcome}`) },
  ];

  return (
    <div className="space-y-6">
      {back}
      <Heading level={1}>{categoryLabel(appointment.serviceCategory)}</Heading>

      <Reveal show={ended === 'ended'}>
        <Alert tone="info">{t('postCall.ended')}</Alert>
      </Reveal>

      {inCall ? (
        <ExpertCall appointment={appointment} employeeName={employeeName} onEnded={onCallEnded} />
      ) : (
        <>
          <Card>
            <h2 className="mb-3 type-label text-text">{t('consultations.participants')}</h2>
            <dl className="gap-x-6 gap-y-3 m-0 grid sm:grid-cols-[max-content_1fr]">
              {rows.map((row) => (
                <div key={row.term} className="contents">
                  <dt className="type-label text-text-secondary">{row.term}</dt>
                  <dd className="m-0 text-text">{row.description}</dd>
                </div>
              ))}
              <div className="contents">
                <dt className="type-label text-text-secondary">{t('appointments.details.status')}</dt>
                <dd className="m-0">
                  <Badge tone={STATUS_TONE[appointment.status]}>{t(`appointments.status.${appointment.status}`)}</Badge>
                </dd>
              </div>
            </dl>
            <p className="mt-4 type-metadata text-text-secondary">{t('followUp.timeZoneNote', { timeZone: appointment.timeZone })}</p>
          </Card>

          {window?.kind === 'open' && joinable ? (
            <section aria-labelledby="join-title" className="gap-4 flex flex-col">
              <h2 id="join-title" className="sr-only">
                {t('join.button')}
              </h2>
              <Reveal show={window.late}>
                <Alert tone="info">{t('join.lateJoin', { time: format.time(appointment.startsAt, appointment.timeZone) })}</Alert>
              </Reveal>
              <div>
                <Button onClick={() => setInCall(true)}>{t('join.button')}</Button>
              </div>
              <RunningLate appointment={appointment} />
            </section>
          ) : null}
          {window?.kind === 'closed' && window.rejoinable && joinable ? (
            // After the first-join window: an expert who already joined may rejoin until the room closes (CALL-06).
            <div className="gap-3 flex flex-col items-start">
              <Button variant="secondary" onClick={() => setInCall(true)}>
                {t('join.rejoin')}
              </Button>
              <p className="type-metadata text-text-secondary">
                {t('join.rejoinHint', { time: format.time(roomClosesAt(appointment), appointment.timeZone) })}
              </p>
            </div>
          ) : null}
          {window?.kind === 'closed' && !window.rejoinable && joinable ? (
            <Alert tone="info">
              <span className="gap-2 flex flex-col">
                <span>{t('join.windowClosed')}</span>
                <TechnicalSupportLink />
              </span>
            </Alert>
          ) : null}
          {window?.kind === 'before' && joinable ? (
            <Button disabled>{t('join.comeBackAt', { time: format.time(window.opensAt, appointment.timeZone) })}</Button>
          ) : null}
          {isSampleDataMode && window?.kind !== 'open' && appointment.status === 'confirmed' && joinable ? (
            <div>
              <Button variant="secondary" onClick={() => setInCall(true)}>
                {t('join.sampleDemo')}
              </Button>
            </div>
          ) : null}

          {canRecordOutcome ? (
            <div>
              <Button onClick={() => setOutcomeOpen(true)}>{t('consultations.recordOutcome')}</Button>
            </div>
          ) : null}
          <Reveal show={recorded !== null}>
            <Alert tone={isSampleDataMode ? 'info' : 'success'}>
              {recorded ? t('consultations.outcomeRecorded', { status: t(`outcome.status.${recorded}`) }) : null}
              {isSampleDataMode ? ` ${t('sample.actionNoop')}` : null}
            </Alert>
          </Reveal>
          {canCancel(principal, effectiveActions) ? <CancelAppointment appointment={appointment} /> : null}
          {showFollowUp ? <ExpertFollowUp appointment={appointment} /> : null}
          <ScheduleFollowUpCard appointment={appointment} />
        </>
      )}

      <OutcomeDialog appointmentId={appointment.id} open={outcomeOpen} onOpenChange={setOutcomeOpen} onRecorded={(value) => setRecorded(value)} />
    </div>
  );
}
