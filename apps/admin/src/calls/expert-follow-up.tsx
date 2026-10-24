/**
 * The expert's side of the follow-up lifecycle (D-CW-37, CALL-35, CALL-37,
 * T-CW-1.9):
 *
 * - {@link ExpertFollowUp}: on a completed consultation, after the outcome,
 *   the "Propose a follow-up" card. In API mode it first looks for a
 *   follow-up of this consultation the expert already proposed, so a reload
 *   shows its state (proposed, waiting for approval, confirmed) with a link
 *   to it instead of an empty form; after a decline the form comes back.
 * - {@link ScheduleFollowUpCard}: on the follow-up itself, the employee's
 *   suggested windows to pick one from (`POST /appointments/:id/schedule`),
 *   or what the expert is waiting for.
 *
 * Every failure renders translated copy (`mapCallError`); sample mode sends
 * nothing and says so.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Heading, RadioGroup, RadioItem } from '@nestself/ui';
import { appointmentKeys } from '@nestself/api-client';
import type { AppointmentResponse, AppointmentStatus, FollowUpProposeRequest } from '@nestself/contracts';
import { FollowUpCard } from '@nestself/video';
import type { ExpertFollowUpStatus, FollowUpProposal } from '@nestself/video';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { durationMinutes, useZonedFormat } from './format';
import { mapCallError } from './map-call-error';
import { Reveal } from './reveal';

/** Which follow-up of a consultation the card describes: an open one first, then a confirmed one, then a declined one. */
const PRECEDENCE: readonly AppointmentStatus[] = ['proposed', 'awaiting_approval', 'confirmed', 'declined'];

function latestFollowUpOf(consultationId: string, items: readonly AppointmentResponse[]): AppointmentResponse | null {
  const followUps = items.filter((item) => item.followUpOf === consultationId);
  for (const status of PRECEDENCE) {
    const match = followUps.filter((item) => item.status === status).at(-1);
    if (match) return match;
  }
  return null;
}

function proposalOf(appointment: AppointmentResponse): FollowUpProposal {
  return { startsAt: appointment.startsAt, durationMinutes: durationMinutes(appointment), timeZone: appointment.timeZone };
}

function cardStatusOf(existing: AppointmentResponse | null): ExpertFollowUpStatus {
  if (!existing || existing.status === 'declined') return 'idle';
  return existing.status === 'confirmed' ? 'confirmed' : 'proposed';
}

export function ExpertFollowUp({ appointment }: { appointment: AppointmentResponse }) {
  const { t } = useTranslation('calls');
  const queryClient = useQueryClient();
  const existing = useQuery({
    queryKey: [...appointmentKeys.lists(), 'follow-up-of', appointment.id],
    queryFn: () => callsApi.listAppointments({ from: appointment.startsAt, limit: 100 }),
    enabled: !isSampleDataMode,
    select: (page) => latestFollowUpOf(appointment.id, page.items),
  });
  const [sent, setSent] = useState<AppointmentResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const followUp = sent ?? existing.data ?? null;
  const status = cardStatusOf(followUp);

  const propose = async (request: FollowUpProposeRequest) => {
    setError(null);
    if (isSampleDataMode) {
      setNotice(t('sample.actionNoop'));
      return;
    }
    setPending(true);
    try {
      setSent(await callsApi.proposeFollowUp(appointment.id, request));
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    } catch (err) {
      setError(mapCallError(err, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="gap-3 flex flex-col">
      <Reveal show={followUp?.status === 'declined'}>
        <Alert tone="info">{t('followUp.declinedPropose')}</Alert>
      </Reveal>
      <FollowUpCard
        variant="expert"
        status={status}
        timeZone={appointment.timeZone}
        defaultDurationMinutes={durationMinutes(appointment)}
        proposal={followUp && status !== 'idle' ? proposalOf(followUp) : null}
        onPropose={(request) => void propose(request)}
        pending={pending}
        error={error}
      />
      <Reveal show={followUp?.status === 'awaiting_approval'}>
        <Alert tone="info">{t('followUp.awaitingApprovalExpert')}</Alert>
      </Reveal>
      {followUp && status !== 'idle' ? (
        <Link
          to="/consultations/$appointmentId"
          params={{ appointmentId: followUp.id }}
          className="type-body text-primary underline underline-offset-[0.2em]"
        >
          {t('followUp.openFollowUp')}
        </Link>
      ) : null}
      <Reveal show={notice !== null}>
        <Alert tone="info">{notice}</Alert>
      </Reveal>
    </div>
  );
}

/**
 * The follow-up as the expert sees it on its own page: waiting for the
 * employee, waiting for approval, or the employee's suggested windows with a
 * choice. Renders nothing for an appointment that is not an open follow-up.
 */
export function ScheduleFollowUpCard({ appointment }: { appointment: AppointmentResponse }) {
  const { t } = useTranslation('calls');
  const format = useZonedFormat();
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: 'success' | 'info'; message: string } | null>(null);

  if (!appointment.followUpOf || (appointment.status !== 'proposed' && appointment.status !== 'awaiting_approval' && !result)) {
    return null;
  }

  const windows = appointment.suggestedWindows ?? [];

  const schedule = async () => {
    setError(null);
    if (choice === '') {
      setError(t('followUp.errors.pickRequired'));
      return;
    }
    if (isSampleDataMode) {
      setResult({ tone: 'info', message: t('sample.actionNoop') });
      return;
    }
    setPending(true);
    try {
      const updated = await callsApi.scheduleFollowUp(appointment.id, { selectedWindowIndex: Number(choice) });
      setResult(
        updated.status === 'awaiting_approval'
          ? { tone: 'info', message: t('followUp.awaitingApprovalExpert') }
          : {
              tone: 'success',
              message: t('followUp.scheduledFor', {
                date: format.date(updated.startsAt, updated.timeZone),
                time: format.time(updated.startsAt, updated.timeZone),
              }),
            },
      );
      queryClient.setQueryData(appointmentKeys.detail(appointment.id), updated);
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    } catch (err) {
      setError(mapCallError(err, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card as="section" className="gap-4 flex flex-col">
      <Heading level={2} typeRole="sectionTitle">
        {windows.length > 0 && appointment.status === 'proposed' ? t('followUp.pickTitle') : t('followUp.proposed')}
      </Heading>
      {appointment.status === 'awaiting_approval' && !result ? <p className="type-body text-text">{t('followUp.awaitingApprovalExpert')}</p> : null}
      {appointment.status === 'proposed' && windows.length === 0 ? <p className="type-body text-text">{t('followUp.waitingForEmployee')}</p> : null}
      {appointment.status === 'proposed' && windows.length > 0 && !result ? (
        <>
          <p className="type-body text-text-secondary">{t('followUp.pickBody')}</p>
          <RadioGroup label={t('followUp.pickLabel')} name="window" value={choice} onValueChange={setChoice} className="gap-2 flex flex-col">
            {windows.map((window, index) => (
              <RadioItem key={window.startsAt} value={String(index)}>
                {t('followUp.pickWindow', {
                  date: format.date(window.startsAt, appointment.timeZone),
                  from: format.time(window.startsAt, appointment.timeZone),
                  to: format.time(window.endsAt, appointment.timeZone),
                })}
              </RadioItem>
            ))}
          </RadioGroup>
          <p className="type-metadata text-text-secondary">{t('followUp.timeZoneNote', { timeZone: appointment.timeZone })}</p>
          <div>
            <Button onClick={() => void schedule()} loading={pending} loadingLabel={t('followUp.sending')}>
              {t('followUp.schedule')}
            </Button>
          </div>
        </>
      ) : null}
      <Reveal show={error !== null}>
        <Alert tone="danger">{error}</Alert>
      </Reveal>
      <Reveal show={result !== null}>
        <Alert tone={result?.tone ?? 'info'}>{result?.message}</Alert>
      </Reveal>
    </Card>
  );
}
