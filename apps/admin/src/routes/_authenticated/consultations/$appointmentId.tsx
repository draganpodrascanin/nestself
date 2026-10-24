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
import type { Appointment, CallOutcomeStatus } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { callsApi } from '../../../calls/calls-api';
import { ExpertCall } from '../../../calls/expert-call';
import { ExpertFollowUp, ScheduleFollowUpCard } from '../../../calls/expert-follow-up';
import type { ExpertCallEnd } from '../../../calls/expert-call';
import { STATUS_TONE, outcomeColumn, useCategoryLabel, useZonedFormat } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';
import { OutcomeDialog } from '../../../calls/outcome-dialog';
import { Reveal } from '../../../calls/reveal';
import { isConsultingExpert, requireConsultingExpert } from '../../../calls/route-gate';
import { sampleFirstName } from '../../../calls/sample';
import { useConsultation } from '../../../calls/use-consultations';
import { useJoinWindow } from '../../../calls/use-join-window';

export const Route = createFileRoute('/_authenticated/consultations/$appointmentId')({
  beforeLoad: ({ context }) => requireConsultingExpert(context.auth),
  component: ConsultationPage,
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

          {window?.kind === 'open' && !recorded ? (
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
          {window?.kind === 'closed' && !recorded ? <Alert tone="info">{t('join.windowClosed')}</Alert> : null}
          {window?.kind === 'before' ? (
            <Button disabled>{t('join.comeBackAt', { time: format.time(window.opensAt, appointment.timeZone) })}</Button>
          ) : null}
          {isSampleDataMode && window?.kind !== 'open' && appointment.status === 'confirmed' ? (
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
          {showFollowUp ? <ExpertFollowUp appointment={appointment} /> : null}
          <ScheduleFollowUpCard appointment={appointment} />
        </>
      )}

      <OutcomeDialog appointmentId={appointment.id} open={outcomeOpen} onOpenChange={setOutcomeOpen} onRecorded={(value) => setRecorded(value)} />
    </div>
  );
}
