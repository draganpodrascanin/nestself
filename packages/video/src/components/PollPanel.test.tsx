import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebinarPoll } from '@nestself/contracts';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { PollPanel } from './PollPanel';

const POLL: WebinarPoll = {
  id: 'poll-1',
  webinarId: 'sample-webinar',
  question: 'Which break would you like to try this week?',
  options: [
    { id: 'opt-walk', label: 'A short walk', position: 0 },
    { id: 'opt-stretch', label: 'Stretching at the desk', position: 1 },
    { id: 'opt-tea', label: 'A cup of tea away from the screen', position: 2 },
  ],
  openedAt: null,
  closedAt: null,
};

function setup() {
  const server = new FakeWebinarServer({ status: 'live', polls: [POLL] });
  const attendee = new FakeWebinarClient({ server, role: 'attendee' });
  const moderator = new FakeWebinarClient({ server, role: 'moderator' });
  attendee.connect();
  moderator.connect();
  return { server, attendee, moderator };
}

describe('PollPanel (WBN-11, WBN-27)', () => {
  it('submits a vote that carries the option only, no voter id', async () => {
    const user = userEvent.setup();
    const { server, attendee } = setup();
    renderWithI18n(<PollPanel client={attendee} />);
    expect(screen.getByText(t('webinar.poll.none'))).toBeInTheDocument();

    act(() => void server.simulate.openPoll('poll-1'));
    expect(await screen.findByText(POLL.question)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('webinar-poll-announcer')).toHaveTextContent(t('webinar.poll.opened', { question: POLL.question })));
    await user.click(screen.getByRole('radio', { name: 'Stretching at the desk' }));
    await user.click(screen.getByRole('button', { name: t('webinar.poll.vote') }));

    const votes = server.requests.filter((request) => request.action === 'poll.vote');
    expect(votes).toHaveLength(1);
    expect(votes[0]!.input).toEqual({ pollId: 'poll-1', body: { optionId: 'opt-stretch' } });
    expect(JSON.stringify(votes[0]!.input)).not.toMatch(/participant|user|voter/i);
  });

  it('disables the button in the already-voted state', async () => {
    const user = userEvent.setup();
    const { server, attendee } = setup();
    server.simulate.openPoll('poll-1');
    renderWithI18n(<PollPanel client={attendee} />);
    await user.click(screen.getByRole('radio', { name: 'A short walk' }));
    await user.click(screen.getByRole('button', { name: t('webinar.poll.vote') }));

    const button = await screen.findByRole('button', { name: t('webinar.poll.votedButton') });
    expect(button).toBeDisabled();
    expect(screen.getByTestId('webinar-poll-voted')).toHaveTextContent(t('webinar.poll.voted'));
    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(server.requests.filter((request) => request.action === 'poll.vote')).toHaveLength(1);
  });

  it('renders aggregate results as percentages after the close', async () => {
    const { server, attendee } = setup();
    server.simulate.openPoll('poll-1');
    server.simulate.vote('poll-1', 'opt-walk');
    server.simulate.vote('poll-1', 'opt-walk');
    server.simulate.vote('poll-1', 'opt-walk');
    server.simulate.vote('poll-1', 'opt-stretch');
    renderWithI18n(<PollPanel client={attendee} />);
    expect(screen.queryByTestId('webinar-poll-results')).toBeNull();

    act(() => void server.simulate.closePoll('poll-1'));
    const results = await screen.findByTestId('webinar-poll-results');
    const rows = within(results).getAllByTestId('webinar-poll-result');
    expect(rows.map((row) => row.textContent)).toEqual(['A short walk75%', 'Stretching at the desk25%', 'A cup of tea away from the screen0%']);
    expect(results).toHaveTextContent(t('webinar.poll.totalVotes', { count: 4 }));
    expect(screen.queryByRole('button', { name: t('webinar.poll.vote') })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('webinar-poll-announcer')).toHaveTextContent(t('webinar.poll.closed')));
  });

  it('asks for a choice before voting and shows a failed vote', async () => {
    const user = userEvent.setup();
    const { server, attendee } = setup();
    server.simulate.openPoll('poll-1');
    renderWithI18n(<PollPanel client={attendee} />);
    await user.click(screen.getByRole('button', { name: t('webinar.poll.vote') }));
    expect(screen.getByText(t('webinar.poll.chooseOption'))).toBeInTheDocument();

    server.simulate.failNext('poll.vote', 'network');
    await user.click(screen.getByRole('radio', { name: 'A short walk' }));
    await user.click(screen.getByRole('button', { name: t('webinar.poll.vote') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.network'));
    expect(screen.getByRole('button', { name: t('webinar.poll.vote') })).toBeEnabled();
  });

  it('lets the moderator open and close a prepared poll', async () => {
    const user = userEvent.setup();
    const { attendee, moderator } = setup();
    renderWithI18n(<PollPanel client={moderator} />);
    const card = screen.getByTestId('webinar-poll-card');
    expect(card).toHaveAttribute('data-state', 'prepared');
    await user.click(within(card).getByRole('button', { name: t('webinar.poll.open') }));
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'open'));
    expect(attendee.getSnapshot().polls.list).toHaveLength(1);
    await user.click(within(card).getByRole('button', { name: t('webinar.poll.close') }));
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'closed'));
    expect(await within(card).findByTestId('webinar-poll-results')).toHaveTextContent(t('webinar.poll.totalVotes', { count: 0 }));
  });

  it('has no accessibility violations with an open poll', async () => {
    const { server, attendee } = setup();
    server.simulate.openPoll('poll-1');
    const { container } = renderWithI18n(<PollPanel client={attendee} />);
    await expectNoA11yViolations(container);
  });
});
