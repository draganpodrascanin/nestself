import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WEBINAR_MESSAGE_TEXT_MAX_LENGTH } from '@nestself/contracts';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { ChatPanel } from './ChatPanel';

function setup() {
  const server = new FakeWebinarServer({ status: 'live' });
  const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana Kovač (sample)' });
  const moderator = new FakeWebinarClient({ server, role: 'moderator', name: 'Mila' });
  moderator.connect();
  return { server, attendee, moderator };
}

const sendRequests = (server: FakeWebinarServer) => server.requests.filter((request) => request.action === 'message.send');

describe('ChatPanel (D-CW-35, WBN-09, WBN-20, WBN-23)', () => {
  it('sends an anonymous message to the hosts by default (kind attendee)', async () => {
    const user = userEvent.setup();
    const { server, attendee, moderator } = setup();
    renderWithI18n(<ChatPanel client={attendee} />);
    expect(screen.getByRole('checkbox', { name: t('webinar.chat.showFirstName') })).not.toBeChecked();

    await user.type(screen.getByLabelText(t('webinar.chat.attendeeLabel')), 'Could you repeat the last slide?');
    await user.click(screen.getByRole('button', { name: t('webinar.chat.send') }));

    expect(await screen.findByTestId('webinar-chat-sent-notice')).toHaveTextContent(t('webinar.messageSubmitted'));
    expect(sendRequests(server)).toEqual([
      expect.objectContaining({ input: { body: { kind: 'attendee', text: 'Could you repeat the last slide?', showFirstName: false } } }),
    ]);
    expect(screen.getByLabelText(t('webinar.chat.attendeeLabel'))).toHaveValue('');
    // Pending messages are for the hosts only.
    expect(screen.queryByTestId('webinar-chat-message')).toBeNull();
    expect(moderator.getSnapshot().moderationMessages[0]).toMatchObject({ authorName: 'Ana Kovač (sample)', authorFirstName: null });
  });

  it('attaches the first name for one question only when asked, then resets the choice', async () => {
    const user = userEvent.setup();
    const { server, attendee, moderator } = setup();
    renderWithI18n(<ChatPanel client={attendee} />);
    await user.click(screen.getByRole('radio', { name: t('webinar.chat.kindQuestion') }));
    await user.click(screen.getByRole('checkbox', { name: t('webinar.chat.showFirstName') }));
    await user.type(screen.getByLabelText(t('webinar.chat.attendeeLabel')), 'How long should a break be?');
    await user.click(screen.getByRole('button', { name: t('webinar.chat.send') }));

    await screen.findByTestId('webinar-chat-sent-notice');
    expect(sendRequests(server).at(-1)).toMatchObject({ input: { body: { kind: 'question', showFirstName: true } } });
    expect(moderator.getSnapshot().moderationMessages[0]).toMatchObject({ kind: 'question', authorFirstName: 'Ana' });
    expect(screen.getByRole('checkbox', { name: t('webinar.chat.showFirstName') })).not.toBeChecked();
  });

  it('shows a published message in the public list and announces it to its author', async () => {
    const user = userEvent.setup();
    const { attendee, moderator } = setup();
    renderWithI18n(<ChatPanel client={attendee} />);
    await user.type(screen.getByLabelText(t('webinar.chat.attendeeLabel')), 'Thank you, the sound is clear.');
    await user.click(screen.getByRole('button', { name: t('webinar.chat.send') }));
    await waitFor(() => expect(moderator.getSnapshot().moderationMessages).toHaveLength(1));

    await act(() => moderator.publish(moderator.getSnapshot().moderationMessages[0]!.id));
    const message = await screen.findByTestId('webinar-chat-message');
    expect(message).toHaveTextContent('Thank you, the sound is clear.');
    expect(message).toHaveTextContent(t('webinar.chat.participant'));
    expect(message).not.toHaveTextContent('Ana');
    await waitFor(() => expect(screen.getByTestId('webinar-chat-announcer')).toHaveTextContent(t('webinar.messagePublished')));
  });

  it('keeps the draft and shows the error when sending fails; validates empty and long text', async () => {
    const user = userEvent.setup();
    const { server, attendee } = setup();
    renderWithI18n(<ChatPanel client={attendee} />);
    const field = screen.getByLabelText(t('webinar.chat.attendeeLabel'));

    await user.click(screen.getByRole('button', { name: t('webinar.chat.send') }));
    expect(screen.getByText(t('webinar.chat.required'))).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');

    await user.click(field);
    await user.paste('x'.repeat(WEBINAR_MESSAGE_TEXT_MAX_LENGTH + 1));
    await user.click(screen.getByRole('button', { name: t('webinar.chat.send') }));
    expect(screen.getByText(t('webinar.chat.tooLong', { max: WEBINAR_MESSAGE_TEXT_MAX_LENGTH }))).toBeInTheDocument();
    expect(sendRequests(server)).toEqual([]);

    await user.clear(field);
    await user.type(field, 'Hello');
    server.simulate.failNext('message.send', 'webinar_not_open');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.webinarNotOpen'));
    expect(field).toHaveValue('Hello');
  });

  it('presenters see only published and answered messages and post to everyone', async () => {
    const user = userEvent.setup();
    const { server } = setup();
    const presenter = new FakeWebinarClient({ server, role: 'presenter', name: 'Marko' });
    server.simulate.attendeeMessage({ participantId: 'p1', name: 'Ana (sample)' }, 'Still pending');
    renderWithI18n(<ChatPanel client={presenter} />);
    expect(screen.queryByText('Still pending')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    await user.type(screen.getByLabelText(t('webinar.chat.hostLabel')), 'Welcome, everyone.');
    await user.click(screen.getByRole('button', { name: t('webinar.chat.sendHost') }));
    const message = await screen.findByTestId('webinar-chat-message');
    expect(message).toHaveAttribute('data-kind', 'host');
    expect(message).toHaveTextContent('Marko');
    expect(sendRequests(server).at(-1)).toMatchObject({ input: { body: { kind: 'host', text: 'Welcome, everyone.' } } });
  });

  it('lets the moderator answer a pending question in place', async () => {
    const user = userEvent.setup();
    const { server, attendee, moderator } = setup();
    attendee.connect();
    const question = server.simulate.attendeeMessage({ participantId: 'p1', name: 'Ana (sample)' }, 'How long?', { kind: 'question' });
    renderWithI18n(<ChatPanel client={moderator} />);
    const card = await screen.findByTestId('webinar-moderation-message');
    expect(card).toHaveTextContent(t('webinar.chat.from', { name: 'Ana (sample)' }));
    expect(card).toHaveTextContent(t('webinar.chat.anonymousToAudience'));

    await user.click(within(card).getByRole('button', { name: t('webinar.moderation.answer') }));
    const form = await screen.findByTestId('webinar-answer-form');
    await user.type(within(form).getByLabelText(t('webinar.moderation.answerLabel')), 'A few minutes.');
    await user.click(within(form).getByRole('button', { name: t('webinar.moderation.sendAnswer') }));

    await waitFor(() => expect(attendee.getSnapshot().publicMessages).toEqual([expect.objectContaining({ id: question.id, answerText: 'A few minutes.' })]));
    await waitFor(() => expect(screen.queryByTestId('webinar-moderation-message')).toBeNull());
    expect(screen.getByTestId('webinar-chat-message')).toHaveTextContent('A few minutes.');
  });

  it('has no accessibility violations in the attendee view', async () => {
    const { attendee } = setup();
    const { container } = renderWithI18n(<ChatPanel client={attendee} />);
    await expectNoA11yViolations(container);
  });
});
