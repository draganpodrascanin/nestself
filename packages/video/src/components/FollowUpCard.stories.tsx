import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FollowUpProposeRequest } from '@nestself/contracts';
import { Button } from '@nestself/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withCallsI18n } from '../stories/decorators';
import { FollowUpCard } from './FollowUpCard';
import type { EmployeeFollowUpStatus, ExpertFollowUpStatus, FollowUpProposal } from './FollowUpCard';

const meta: Meta<typeof FollowUpCard> = {
  title: 'Video/FollowUpCard',
  component: FollowUpCard,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof FollowUpCard>;

const PROPOSAL: FollowUpProposal = { startsAt: '2030-03-04T09:30:00.000Z', durationMinutes: 45, timeZone: 'Europe/Belgrade' };

/** Story only: proposing changes local state; no appointment is created. */
function ExpertDemo({ initial = 'idle', withError = false }: { initial?: ExpertFollowUpStatus; withError?: boolean }) {
  const { t } = useTranslation('calls');
  const [status, setStatus] = useState<ExpertFollowUpStatus>(initial);
  const [proposal, setProposal] = useState<FollowUpProposal | null>(initial === 'idle' ? null : PROPOSAL);
  return (
    <FollowUpCard
      variant="expert"
      status={status}
      timeZone="Europe/Belgrade"
      defaultDurationMinutes={45}
      proposal={proposal}
      error={withError ? t('errors.followUpNotAllowed') : null}
      onPropose={(request: FollowUpProposeRequest) => {
        setProposal(request);
        setStatus('proposed');
      }}
    />
  );
}

/** Story only: answers change local state; nothing is sent. */
function EmployeeDemo({ initial = 'proposed', withError = false, arrives = false }: { initial?: EmployeeFollowUpStatus; withError?: boolean; arrives?: boolean }) {
  const { t } = useTranslation('calls');
  const [status, setStatus] = useState<EmployeeFollowUpStatus>(arrives ? 'no_proposal' : initial);
  const [suggested, setSuggested] = useState(false);
  return (
    <div className="gap-4 flex flex-col items-start">
      {arrives ? (
        <Button size="sm" variant="secondary" onClick={() => setStatus((value) => (value === 'no_proposal' ? 'proposed' : 'no_proposal'))}>
          {status === 'no_proposal' ? 'A proposal arrives (story only)' : 'Remove the proposal (story only)'}
        </Button>
      ) : null}
      <FollowUpCard
        variant="employee"
        status={status}
        proposal={status === 'no_proposal' ? null : PROPOSAL}
        timesSuggested={suggested}
        error={withError ? t('errors.approverMissing') : null}
        onConfirm={() => setStatus('confirmed')}
        onSuggestTimes={() => setSuggested(true)}
        onDecline={() => setStatus('declined')}
      />
    </div>
  );
}

export const ExpertPropose: Story = { render: () => <ExpertDemo /> };
export const ExpertProposed: Story = { render: () => <ExpertDemo initial="proposed" /> };
export const ExpertWithError: Story = { render: () => <ExpertDemo withError /> };
export const EmployeeProposal: Story = { render: () => <EmployeeDemo /> };
/** The card animates in when a proposal arrives and out when it goes (motion suite entry). */
export const ProposalArrives: Story = { render: () => <EmployeeDemo arrives /> };
export const EmployeeAwaitingApproval: Story = { render: () => <EmployeeDemo initial="awaiting_approval" /> };
export const EmployeeConfirmed: Story = { render: () => <EmployeeDemo initial="confirmed" /> };
export const EmployeeApproverMissing: Story = { render: () => <EmployeeDemo withError /> };
export const Serbian: Story = { render: () => <EmployeeDemo />, parameters: { locale: 'sr-Latn' } };
export const Hungarian: Story = { render: () => <ExpertDemo />, parameters: { locale: 'hu' } };
