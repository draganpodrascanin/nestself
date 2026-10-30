import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeCallSessionController } from '../testing/fake-controller';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { ChatPanel } from './ChatPanel';
import { FloorGrantedDialog } from './FloorGrantedDialog';
import { ModeratorQueue } from './ModeratorQueue';

async function setup() {
  const server = new FakeWebinarServer({ status: 'live' });
  const controller = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
  await controller.join();
  const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana Kovač (sample)', audio: controller });
  const moderator = new FakeWebinarClient({ server, role: 'moderator', name: 'Mila' });
  attendee.connect();
  moderator.connect();
  return { server, controller, attendee, moderator, participantId: attendee.getSnapshot().participantId! };
}

describe('ModeratorQueue (WBN-10, WBN-19, WBN-23 to WBN-25, WBN-28)', () => {
  it('shows a pending message with the registration name as it arrives', async () => {
    const { attendee, moderator } = await setup();
    renderWithI18n(<ModeratorQueue client={moderator} />);
    expect(screen.getByText(t('webinar.moderation.pendingEmpty'))).toBeInTheDocument();

    await act(() => attendee.sendMessage({ kind: 'question', text: 'How long should a break be?', showFirstName: false }));
    const card = await screen.findByTestId('webinar-moderation-message');
    expect(card).toHaveTextContent('How long should a break be?');
    expect(card).toHaveTextContent(t('webinar.chat.from', { name: 'Ana Kovač (sample)' }));
    expect(card).toHaveTextContent(t('webinar.chat.question'));
    await waitFor(() => expect(screen.getByTestId('webinar-queue-announcer')).toHaveTextContent(t('webinar.moderation.announce.submitted')));
  });

  it('publish moves the message out of the queue and into the public list everyone sees', async () => {
    const user = userEvent.setup();
    const { attendee, moderator } = await setup();
    await attendee.sendMessage({ kind: 'attendee', text: 'Thank you, the slides are clear.', showFirstName: false });
    renderWithI18n(
      <>
        <ModeratorQueue client={moderator} />
        <ChatPanel client={attendee} />
      </>,
    );
    const card = await screen.findByTestId('webinar-moderation-message');
    await user.click(within(card).getByRole('button', { name: t('webinar.moderation.publish') }));

    await waitFor(() => expect(screen.queryByTestId('webinar-moderation-message')).toBeNull());
    expect(screen.getByText(t('webinar.moderation.pendingEmpty'))).toBeInTheDocument();
    const published = await screen.findByTestId('webinar-chat-message');
    expect(published).toHaveTextContent('Thank you, the slides are clear.');
    expect(published).not.toHaveTextContent('Ana');
    expect(moderator.getSnapshot().publicMessages).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('webinar-queue-announcer')).toHaveTextContent(t('webinar.moderation.announce.published')));
  });

  it('publishes an edited text', async () => {
    const user = userEvent.setup();
    const { server, attendee, moderator } = await setup();
    await attendee.sendMessage({ kind: 'attendee', text: 'teh slides are clear', showFirstName: false });
    renderWithI18n(<ModeratorQueue client={moderator} />);
    const card = await screen.findByTestId('webinar-moderation-message');
    await user.click(within(card).getByRole('button', { name: t('webinar.moderation.edit') }));
    const form = await screen.findByTestId('webinar-edit-form');
    const field = within(form).getByLabelText(t('webinar.moderation.editLabel'));
    await user.clear(field);
    await user.type(field, 'The slides are clear');
    await user.click(within(form).getByRole('button', { name: t('webinar.moderation.publishEdited') }));
    await waitFor(() => expect(attendee.getSnapshot().publicMessages[0]?.text).toBe('The slides are clear'));
    expect(server.requests.at(-1)).toMatchObject({ action: 'message.publish', input: { body: { text: 'The slides are clear' } } });
  });

  it('shows the registration name of a raised hand to the moderator, and a presenter the hand without a name (WBN-10.3)', async () => {
    const { server, attendee, moderator } = await setup();
    const presenter = new FakeWebinarClient({ server, role: 'presenter', name: 'Marko' });
    renderWithI18n(
      <>
        <div data-testid="moderator">
          <ModeratorQueue client={moderator} />
        </div>
        <div data-testid="presenter">
          <ModeratorQueue client={presenter} />
        </div>
      </>,
    );
    await act(() => attendee.raiseHand());

    const moderatorHand = await within(screen.getByTestId('moderator')).findByTestId('webinar-queue-hand');
    expect(moderatorHand).toHaveTextContent('Ana Kovač (sample)');
    expect(within(moderatorHand).getByRole('button', { name: t('webinar.moderation.giveFloorTo', { name: 'Ana Kovač (sample)' }) })).toBeInTheDocument();
    const presenterView = screen.getByTestId('presenter');
    const presenterHand = await within(presenterView).findByTestId('webinar-queue-hand');
    expect(presenterHand).toHaveTextContent(t('webinar.handRaisedPresenter'));
    // WBN-25.1: a presenter gives the floor too; the button is described by the anonymous line, never a name.
    const give = within(presenterHand).getByRole('button', { name: t('webinar.moderation.giveFloor') });
    expect(give).toHaveAccessibleDescription(new RegExp(t('webinar.handRaisedPresenter')));
    expect(presenterView).not.toHaveTextContent('Ana');
    expect(JSON.stringify(presenter.getSnapshot())).not.toContain('Ana');
    expect(within(presenterView).queryByText(t('webinar.moderation.pendingTitle'))).toBeNull();
  });

  it('give the floor opens the "you can speak now" dialog for the attendee, audio only', async () => {
    const user = userEvent.setup();
    const { controller, attendee, moderator } = await setup();
    await attendee.raiseHand();
    renderWithI18n(
      <>
        <ModeratorQueue client={moderator} />
        <FloorGrantedDialog client={attendee} controller={controller} />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: t('webinar.moderation.giveFloorTo', { name: 'Ana Kovač (sample)' }) }));

    const dialog = await screen.findByRole('dialog', { name: t('webinar.floorDialog.title') });
    expect(dialog).toHaveTextContent(t('webinar.recordingNoticeFloor'));
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(true));
    expect(controller.getSnapshot().devices.canSendVideo).toBe(false);
    expect(controller.getSnapshot().media).toMatchObject({ muted: true, cameraOn: false });
    expect(await screen.findByTestId('webinar-queue-speaker')).toHaveTextContent('Ana Kovač (sample)');
  });

  it('take the floor back reverses the audio capability and mutes the attendee', async () => {
    const user = userEvent.setup();
    const { server, controller, attendee, moderator, participantId } = await setup();
    await attendee.raiseHand();
    await moderator.giveFloor(participantId);
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(true));
    attendee.acknowledgeFloor();
    controller.setMuted(false);
    renderWithI18n(<ModeratorQueue client={moderator} />);

    await user.click(screen.getByRole('button', { name: t('webinar.moderation.takeFloorFrom', { name: 'Ana Kovač (sample)' }) }));
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(false));
    expect(controller.getSnapshot().media.muted).toBe(true);
    expect(attendee.getSnapshot().myFloor.status).toBe('taken');
    expect(server.emitted.find((entry) => entry.event === 'webinar.floor.taken')).toMatchObject({
      to: participantId,
      payload: { capabilities: { audio: 'receive', video: 'receive' } },
    });
    await waitFor(() => expect(screen.queryByTestId('webinar-queue-speakers')).toBeNull());
  });

  it('mutes a speaker and asks them to unmute; only their consent unmutes (WBN-26)', async () => {
    const user = userEvent.setup();
    const { controller, attendee, moderator, participantId } = await setup();
    await attendee.raiseHand();
    await moderator.giveFloor(participantId);
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(true));
    attendee.acknowledgeFloor();
    controller.setMuted(false);
    renderWithI18n(<ModeratorQueue client={moderator} />);

    await user.click(screen.getByRole('button', { name: t('webinar.moderation.muteName', { name: 'Ana Kovač (sample)' }) }));
    const speaker = await screen.findByTestId('webinar-queue-speaker');
    await waitFor(() => expect(speaker).toHaveAttribute('data-muted', 'true'));
    expect(speaker).toHaveTextContent(t('webinar.moderation.muted'));
    expect(controller.getSnapshot().media.muted).toBe(true);
    expect(attendee.getSnapshot().myFloor.mutedByHost).toBe(true);

    await user.click(within(speaker).getByRole('button', { name: t('webinar.moderation.askUnmuteName', { name: 'Ana Kovač (sample)' }) }));
    expect(await within(speaker).findByRole('button', { name: t('webinar.moderation.unmuteAsked') })).toBeDisabled();
    expect(controller.getSnapshot().media.muted).toBe(true);
    await act(() => attendee.consentToUnmute());
    await waitFor(() => expect(speaker).not.toHaveAttribute('data-muted'));
    expect(controller.getSnapshot().media.muted).toBe(false);
  });

  it('lets a presenter give the floor to a raised hand, anonymously, and take it back (WBN-25.1)', async () => {
    const user = userEvent.setup();
    const { server, controller, attendee, participantId } = await setup();
    const presenter = new FakeWebinarClient({ server, role: 'presenter', name: 'Marko' });
    renderWithI18n(<ModeratorQueue client={presenter} />);
    await act(() => attendee.raiseHand());

    const hand = await screen.findByTestId('webinar-queue-hand');
    await user.click(within(hand).getByRole('button', { name: t('webinar.moderation.giveFloor') }));
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(true));
    expect(server.requests.find((request) => request.action === 'floor.give')).toMatchObject({ input: { participantId } });
    expect(attendee.getSnapshot().myFloor.status).toBe('given');
    // The hand is down and the speaker row names nobody; the presenter who gave the floor can take it back.
    await waitFor(() => expect(screen.queryByTestId('webinar-queue-hand')).toBeNull());
    const speaker = await screen.findByTestId('webinar-queue-speaker');
    expect(speaker).not.toHaveTextContent('Ana');
    await user.click(within(speaker).getByRole('button', { name: t('webinar.moderation.takeFloorFrom', { name: t('webinar.chat.participant') }) }));
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(false));
    expect(JSON.stringify(presenter.getSnapshot())).not.toContain('Ana');
  });

  it('a presenter who arrives after hands were raised can give the floor to them (WBN-25.1)', async () => {
    const { server, attendee } = await setup();
    await attendee.raiseHand();
    const presenter = new FakeWebinarClient({ server, role: 'presenter', name: 'Marko' });
    renderWithI18n(<ModeratorQueue client={presenter} />);
    const hand = await screen.findByTestId('webinar-queue-hand');
    expect(within(hand).getByRole('button', { name: t('webinar.moderation.giveFloor') })).toBeEnabled();
    expect(hand).not.toHaveTextContent('Ana');
  });

  it('lets a presenter take the floor back from the floor holder the hosts room names, anonymously (WBN-25)', async () => {
    const user = userEvent.setup();
    const { server, controller, attendee, moderator, participantId } = await setup();
    await attendee.raiseHand();
    await moderator.giveFloor(participantId);
    // The presenter arrives after the floor was given (a reload): the hosts room's snapshot names the holder by id.
    const presenter = new FakeWebinarClient({ server, role: 'presenter', name: 'Marko' });
    renderWithI18n(<ModeratorQueue client={presenter} />);
    const speaker = await screen.findByTestId('webinar-queue-speaker');
    expect(speaker).toHaveTextContent(t('webinar.chat.participant'));
    expect(speaker).not.toHaveTextContent('Ana');
    await user.click(within(speaker).getByRole('button', { name: t('webinar.moderation.takeFloorFrom', { name: t('webinar.chat.participant') }) }));
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(false));
    await waitFor(() => expect(screen.queryByTestId('webinar-queue-speaker')).toBeNull());
  });

  it('shows the attendance count as a number and stops the recording after a confirmation', async () => {
    const user = userEvent.setup();
    const { server, moderator } = await setup();
    server.simulate.recording('started');
    renderWithI18n(<ModeratorQueue client={moderator} />);
    act(() => server.simulate.attendance(42));
    expect(screen.getByTestId('webinar-queue-attendance')).toHaveTextContent(t('webinar.attendance', { count: 42 }));

    await user.click(screen.getByRole('button', { name: t('webinar.moderation.stopRecording') }));
    const dialog = await screen.findByRole('alertdialog', { name: t('webinar.moderation.stopRecordingTitle') });
    await user.click(within(dialog).getByRole('button', { name: t('webinar.moderation.stopRecording') }));
    await waitFor(() => expect(moderator.getSnapshot().recording.status).toBe('processing'));
    expect(await screen.findByText(t('webinar.moderation.recordingOff'))).toBeInTheDocument();
  });

  it('shows a failed floor action and renders nothing for an attendee client', async () => {
    const user = userEvent.setup();
    const { server, attendee, moderator } = await setup();
    await attendee.raiseHand();
    server.simulate.failNext('floor.give', 'floor_not_available');
    const { container } = renderWithI18n(<ModeratorQueue client={moderator} />);
    await user.click(await screen.findByRole('button', { name: t('webinar.moderation.giveFloorTo', { name: 'Ana Kovač (sample)' }) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.floorNotAvailable'));
    await expectNoA11yViolations(container);

    const other = renderWithI18n(<ModeratorQueue client={attendee} />);
    expect(other.container).toBeEmptyDOMElement();
  });
});
