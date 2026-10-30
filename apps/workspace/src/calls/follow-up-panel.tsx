/**
 * The employee's answer to a proposed follow-up (CALL-36, CALL-37, CALL-42),
 * shared by the appointment page and the post-call screen.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '@nestself/ui';
import { appointmentKeys } from '@nestself/api-client';
import type { AppointmentView } from '@nestself/api-client';
import type { Appointment, FollowUpSuggestTimesRequest } from '@nestself/contracts';
import { FollowUpCard } from '@nestself/video';
import type { EmployeeFollowUpStatus, FollowUpProposal } from '@nestself/video';
import { isSampleDataMode } from '../data-source';
import { callsApi } from './calls-api';
import { durationMinutes } from './format';
import { mapCallError } from './map-call-error';
import { Reveal } from './reveal';

const FOLLOW_UP_STATUS: Partial<Record<Appointment['status'], EmployeeFollowUpStatus>> = {
  proposed: 'proposed',
  awaiting_approval: 'awaiting_approval',
};

export interface EmployeeFollowUpPanelProps {
  /** The proposed appointment the answer applies to. */
  followUpId: string;
  proposal: FollowUpProposal | null;
  status: EmployeeFollowUpStatus;
  /** The employee already suggested other windows (the API returns them). */
  timesSuggested?: boolean;
  /** How the approval of a confirmed follow-up ended without a booking (CALL-39), with the approver's reason. */
  approvalOutcome?: AppointmentView['approvalOutcome'];
  declineReason?: string;
}

/** The follow-up card's input for an appointment that is itself a proposal (CALL-42). */
export function followUpOf(appointment: AppointmentView): EmployeeFollowUpPanelProps {
  return {
    approvalOutcome: appointment.followUpOf ? appointment.approvalOutcome : undefined,
    declineReason: appointment.declineReason,
    followUpId: appointment.id,
    proposal: { startsAt: appointment.startsAt, durationMinutes: durationMinutes(appointment), timeZone: appointment.timeZone },
    status: FOLLOW_UP_STATUS[appointment.status] ?? 'no_proposal',
    timesSuggested: (appointment.suggestedWindows?.length ?? 0) > 0,
  };
}

/**
 * The employee's answer to a proposed follow-up, on the appointment page
 * and the post-call screen (CALL-36, CALL-37, CALL-42). The card stays
 * mounted and shows the answer once given; every failure is rendered on the
 * card. In sample mode nothing is sent and a notice says so.
 */
export function EmployeeFollowUpPanel({
  followUpId,
  proposal,
  status: given,
  timesSuggested: suggestedBefore = false,
  approvalOutcome,
  declineReason,
}: EmployeeFollowUpPanelProps) {
  const { t } = useTranslation('calls');
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [timesSuggested, setTimesSuggested] = useState(suggestedBefore);
  const [answer, setAnswer] = useState<EmployeeFollowUpStatus | null>(null);
  const [now] = useState(() => Date.now());
  // The proposed time has passed: it can no longer be confirmed (409 follow_up_not_allowed). With other
  // times already suggested, the expert may still pick one; otherwise the expert proposes again.
  const expired = answer === null && given === 'proposed' && proposal !== null && Date.parse(proposal.startsAt) <= now;
  const status = expired ? 'no_proposal' : (answer ?? given);

  const run = async (action: () => Promise<Appointment>, after: (updated: Appointment) => void) => {
    setError(null);
    if (isSampleDataMode) {
      setNotice(t('sample.actionNoop'));
      return;
    }
    setPending(true);
    try {
      const updated = await action();
      after(updated);
      queryClient.setQueryData(appointmentKeys.detail(followUpId), updated);
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    } catch (err) {
      setError(mapCallError(err, t));
    } finally {
      setPending(false);
    }
  };

  // CALL-39: the approver's safe reason, or that the approval lapsed. Never shown to anyone but the employee.
  const approvalNotice =
    approvalOutcome === 'expired'
      ? t('followUp.approvalExpired')
      : approvalOutcome === 'rejected'
        ? declineReason
          ? t('followUp.approvalRejected', { reason: declineReason })
          : t('followUp.approvalRejectedNoReason')
        : null;

  return (
    <div className="gap-3 flex flex-col">
      {approvalNotice ? <Alert tone="info">{approvalNotice}</Alert> : null}
      <Reveal show={expired}>
        <Alert tone="info">{timesSuggested ? t('followUp.timesSuggested') : t('followUp.expired')}</Alert>
      </Reveal>
      <FollowUpCard
        variant="employee"
        status={status}
        proposal={proposal}
        timesSuggested={timesSuggested}
        pending={pending}
        error={error}
        onConfirm={() =>
          void run(
            () => callsApi.confirmFollowUp(followUpId),
            (updated) => setAnswer(updated.status === 'awaiting_approval' ? 'awaiting_approval' : 'confirmed'),
          )
        }
        onSuggestTimes={(request: FollowUpSuggestTimesRequest) =>
          void run(
            () => callsApi.suggestFollowUpTimes(followUpId, request),
            () => setTimesSuggested(true),
          )
        }
        onDecline={() => void run(() => callsApi.declineFollowUp(followUpId), () => setAnswer('declined'))}
      />
      <Reveal show={notice !== null}>
        <Alert tone="info">{notice}</Alert>
      </Reveal>
    </div>
  );
}
