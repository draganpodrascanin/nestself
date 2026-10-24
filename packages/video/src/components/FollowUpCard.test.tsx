import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FOLLOW_UP_MAX_SUGGESTED_WINDOWS, FollowUpProposeRequestSchema, FollowUpSuggestTimesRequestSchema } from '@nestself/contracts';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FollowUpCard } from './FollowUpCard';
import type { EmployeeFollowUpCardProps, ExpertFollowUpCardProps } from './FollowUpCard';

const PROPOSAL = { startsAt: '2030-03-04T09:30:00.000Z', durationMinutes: 45, timeZone: 'Europe/Belgrade' };

function expert(overrides: Partial<ExpertFollowUpCardProps> = {}): ExpertFollowUpCardProps {
  return { variant: 'expert', status: 'idle', timeZone: 'Europe/Belgrade', defaultDurationMinutes: 45, onPropose: vi.fn(), ...overrides };
}

function employee(overrides: Partial<EmployeeFollowUpCardProps> = {}): EmployeeFollowUpCardProps {
  return {
    variant: 'employee',
    status: 'proposed',
    proposal: PROPOSAL,
    onConfirm: vi.fn(),
    onSuggestTimes: vi.fn(),
    onDecline: vi.fn(),
    ...overrides,
  };
}

function setValue(label: string, value: string, scope: HTMLElement = document.body) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

describe('FollowUpCard, expert (D-CW-37, CALL-35)', () => {
  it('sends the proposal in the appointment time zone with the default duration', async () => {
    const user = userEvent.setup();
    const props = expert();
    renderWithI18n(<FollowUpCard {...props} />);
    expect(screen.getByRole('heading', { name: t('followUp.expertTitle') })).toBeInTheDocument();
    expect(screen.getByText(t('followUp.expertNote'))).toBeInTheDocument();
    expect(screen.getByText(t('followUp.timeZoneNote', { timeZone: 'Europe/Belgrade' }))).toBeInTheDocument();
    setValue(t('followUp.date'), '2030-03-04');
    setValue(t('followUp.time'), '10:30');
    await user.click(screen.getByRole('button', { name: t('followUp.send') }));
    expect(props.onPropose).toHaveBeenCalledWith(PROPOSAL);
    expect(FollowUpProposeRequestSchema.safeParse(vi.mocked(props.onPropose).mock.calls[0]![0]).success).toBe(true);
  });

  it('has no free-text field: the note is fixed copy (D-22)', () => {
    renderWithI18n(<FollowUpCard {...expert()} />);
    expect(screen.queryByRole('textbox', { name: /note/i })).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('validates the date and time before sending', async () => {
    const user = userEvent.setup();
    const props = expert();
    renderWithI18n(<FollowUpCard {...props} />);
    await user.click(screen.getByRole('button', { name: t('followUp.send') }));
    expect(await screen.findByText(t('followUp.errors.dateTimeRequired'))).toBeInTheDocument();
    setValue(t('followUp.date'), '2020-01-01');
    setValue(t('followUp.time'), '09:00');
    await user.click(screen.getByRole('button', { name: t('followUp.send') }));
    expect(await screen.findByText(t('followUp.errors.past'))).toBeInTheDocument();
    expect(props.onPropose).not.toHaveBeenCalled();
  });

  it('renders the error it is given and shows the proposed state', () => {
    const { rerender } = renderWithI18n(<FollowUpCard {...expert({ error: t('errors.followUpNotAllowed') })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(t('errors.followUpNotAllowed'));
    rerender(<FollowUpCard {...expert({ status: 'proposed', proposal: PROPOSAL })} />);
    expect(screen.getByText(t('followUp.waitingForEmployee'))).toBeInTheDocument();
    expect(screen.getByText(/10:30/)).toBeInTheDocument();
  });
});

describe('FollowUpCard, employee (D-CW-37, CALL-36, CALL-37)', () => {
  it('shows the proposal and sends the confirmation', async () => {
    const user = userEvent.setup();
    const props = employee();
    renderWithI18n(<FollowUpCard {...props} />);
    expect(screen.getByRole('heading', { name: t('followUp.employeeTitle') })).toBeInTheDocument();
    expect(screen.getByText(/10:30/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('followUp.confirm') }));
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it('declines', async () => {
    const user = userEvent.setup();
    const props = employee();
    renderWithI18n(<FollowUpCard {...props} />);
    await user.click(screen.getByRole('button', { name: t('followUp.decline') }));
    expect(props.onDecline).toHaveBeenCalledOnce();
  });

  it('suggests up to three time windows', async () => {
    const user = userEvent.setup();
    const props = employee();
    renderWithI18n(<FollowUpCard {...props} />);
    await user.click(screen.getByRole('button', { name: t('followUp.suggestTimes') }));
    const form = await screen.findByRole('group', { name: t('followUp.suggestTitle') });
    const add = within(form).getByRole('button', { name: t('followUp.addWindow') });
    await user.click(add);
    await user.click(add);
    expect(within(form).queryByRole('button', { name: t('followUp.addWindow') })).toBeNull();
    for (let index = 1; index <= FOLLOW_UP_MAX_SUGGESTED_WINDOWS; index += 1) {
      const window = within(form).getByRole('group', { name: t('followUp.window', { index }) });
      setValue(t('followUp.date'), `2030-03-0${index + 4}`, window);
      setValue(t('followUp.from'), '09:00', window);
      setValue(t('followUp.to'), '11:00', window);
    }
    await user.click(within(form).getByRole('button', { name: t('followUp.sendSuggestions') }));
    expect(props.onSuggestTimes).toHaveBeenCalledWith({
      windows: [
        { startsAt: '2030-03-05T08:00:00.000Z', endsAt: '2030-03-05T10:00:00.000Z' },
        { startsAt: '2030-03-06T08:00:00.000Z', endsAt: '2030-03-06T10:00:00.000Z' },
        { startsAt: '2030-03-07T08:00:00.000Z', endsAt: '2030-03-07T10:00:00.000Z' },
      ],
    });
    expect(FollowUpSuggestTimesRequestSchema.safeParse(vi.mocked(props.onSuggestTimes).mock.calls[0]![0]).success).toBe(true);
  });

  it('refuses a window that ends before it starts, and removes a window', async () => {
    const user = userEvent.setup();
    const props = employee();
    renderWithI18n(<FollowUpCard {...props} />);
    await user.click(screen.getByRole('button', { name: t('followUp.suggestTimes') }));
    const form = await screen.findByRole('group', { name: t('followUp.suggestTitle') });
    await user.click(within(form).getByRole('button', { name: t('followUp.addWindow') }));
    await user.click(within(form).getByRole('button', { name: t('followUp.removeWindow', { index: 2 }) }));
    const window = within(form).getByRole('group', { name: t('followUp.window', { index: 1 }) });
    setValue(t('followUp.date'), '2030-03-05', window);
    setValue(t('followUp.from'), '11:00', window);
    setValue(t('followUp.to'), '09:00', window);
    await user.click(within(form).getByRole('button', { name: t('followUp.sendSuggestions') }));
    expect(await within(form).findByText(t('followUp.errors.endBeforeStart'))).toBeInTheDocument();
    expect(props.onSuggestTimes).not.toHaveBeenCalled();
  });

  it('closes the suggestion form with an exit animation', async () => {
    const user = userEvent.setup();
    renderWithI18n(<FollowUpCard {...employee()} />);
    await user.click(screen.getByRole('button', { name: t('followUp.suggestTimes') }));
    const form = await screen.findByRole('group', { name: t('followUp.suggestTitle') });
    await user.click(within(form).getByRole('button', { name: t('followUp.cancel') }));
    expect(screen.queryByRole('group', { name: t('followUp.suggestTitle') })).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('group', { name: t('followUp.suggestTitle') })).toBeNull());
  });

  it('shows awaiting approval and renders errors such as a missing approver', () => {
    renderWithI18n(<FollowUpCard {...employee({ status: 'awaiting_approval', error: t('errors.approverMissing') })} />);
    expect(screen.getByText(t('followUp.awaitingApproval'))).toBeInTheDocument();
    expect(screen.getByText(t('followUp.awaitingApprovalBody'))).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(t('errors.approverMissing'));
  });

  it('animates in when a proposal arrives and out when it is gone', async () => {
    const props = employee({ status: 'no_proposal', proposal: null });
    const { rerender } = renderWithI18n(<FollowUpCard {...props} />);
    expect(screen.queryByRole('heading', { name: t('followUp.employeeTitle') })).toBeNull();
    rerender(<FollowUpCard {...employee()} />);
    const card = screen.getByRole('region', { name: t('followUp.employeeTitle') });
    expect(card.style.opacity).not.toBe('');
    rerender(<FollowUpCard {...props} />);
    expect(screen.queryByRole('region', { name: t('followUp.employeeTitle') })).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('region', { name: t('followUp.employeeTitle') })).toBeNull());
  });

  it('passes axe', async () => {
    const { container } = renderWithI18n(<FollowUpCard {...employee()} />);
    await expectNoA11yViolations(container);
  });
});
