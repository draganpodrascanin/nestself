import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeCallSessionController } from '../testing/fake-controller';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { FloorGrantedDialog, FloorTakenNotice } from './FloorGrantedDialog';

async function setup() {
  const server = new FakeWebinarServer({ status: 'live' });
  const controller = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
  await controller.join();
  const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana (sample)', audio: controller });
  const participantId = attendee.getSnapshot().participantId!;
  return { server, controller, attendee, participantId };
}

describe('FloorGrantedDialog (CW-R-125, WBN-10, WBN-25)', () => {
  it('opens on the floor event with the recording notice, and the attendee stays muted', async () => {
    const { server, controller, attendee, participantId } = await setup();
    renderWithI18n(<FloorGrantedDialog client={attendee} controller={controller} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => void server.simulate.floorGiven(participantId));
    const dialog = await screen.findByRole('dialog', { name: t('webinar.floorDialog.title') });
    expect(dialog).toHaveAccessibleDescription(t('webinar.youCanSpeakNow'));
    expect(within(dialog).getByText(t('webinar.recordingNoticeFloor'))).toBeInTheDocument();
    expect(within(dialog).getByTestId('webinar-floor-dialog')).toBeInTheDocument();
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(true));
    expect(controller.getSnapshot().media.muted).toBe(true);
    expect(controller.getSnapshot().devices.canSendVideo).toBe(false);
    await expectNoA11yViolations(document.body);
  });

  it('"Unmute now" acknowledges and unmutes; the exit animates before the dialog unmounts', async () => {
    const user = userEvent.setup();
    const { server, controller, attendee, participantId } = await setup();
    renderWithI18n(<FloorGrantedDialog client={attendee} controller={controller} />);
    act(() => void server.simulate.floorGiven(participantId));
    await screen.findByRole('dialog');
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(true));

    await user.click(screen.getByRole('button', { name: t('webinar.floorDialog.unmute') }));
    expect(attendee.getSnapshot().myFloor).toEqual({ status: 'given', acknowledged: true });
    expect(controller.getSnapshot().media.muted).toBe(false);
    expect(screen.queryByTestId('webinar-floor-dialog')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('webinar-floor-dialog')).toBeNull());
  });

  it('"Not now" and Escape close it without unmuting and without lowering the hand', async () => {
    const user = userEvent.setup();
    const { server, controller, attendee, participantId } = await setup();
    await attendee.raiseHand();
    renderWithI18n(<FloorGrantedDialog client={attendee} controller={controller} />);
    act(() => void server.simulate.floorGiven(participantId));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(attendee.getSnapshot().myFloor.acknowledged).toBe(true);
    expect(attendee.getSnapshot().myHand.raised).toBe(true);
    expect(controller.getSnapshot().media.muted).toBe(true);
    expect(server.requests.some((request) => request.action === 'hand.lower')).toBe(false);
  });

  it('when the floor is taken back the attendee is muted, loses the microphone and sees a notice', async () => {
    const user = userEvent.setup();
    const { server, controller, attendee, participantId } = await setup();
    renderWithI18n(
      <>
        <FloorGrantedDialog client={attendee} controller={controller} />
        <FloorTakenNotice client={attendee} />
      </>,
    );
    act(() => void server.simulate.floorGiven(participantId));
    await user.click(await screen.findByRole('button', { name: t('webinar.floorDialog.unmute') }));
    expect(controller.getSnapshot().media.muted).toBe(false);

    act(() => void server.simulate.floorTaken(participantId));
    const notice = await screen.findByTestId('webinar-floor-taken-notice');
    expect(notice).toHaveTextContent(t('webinar.floorTaken'));
    await waitFor(() => expect(controller.getSnapshot().devices.canSendAudio).toBe(false));
    expect(controller.getSnapshot().media.muted).toBe(true);

    await user.click(within(notice).getByRole('button', { name: t('webinar.floorTakenOk') }));
    expect(screen.queryByTestId('webinar-floor-taken-notice')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('webinar-floor-taken-notice')).toBeNull());
  });

  it('shows a microphone failure inside the dialog', async () => {
    const { server, attendee, participantId } = await setup();
    const failing = { setMuted: () => undefined };
    const broken = new FakeWebinarClient({
      server,
      role: 'attendee',
      participantId: `${participantId}-b`,
      audio: { setMuted: () => undefined, setAudioCapability: () => Promise.reject(new Error('NotAllowedError')) },
    });
    renderWithI18n(<FloorGrantedDialog client={broken} controller={failing} />);
    act(() => void server.simulate.floorGiven(`${participantId}-b`));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('webinar.errors.microphoneUnavailable'));
    expect(attendee.getSnapshot().myFloor.status).toBe('none');
  });
});
