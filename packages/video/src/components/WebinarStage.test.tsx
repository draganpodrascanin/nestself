import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeCallSessionController } from '../testing/fake-controller';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import type { WebinarViewerRole } from '../webinar/types';
import { WebinarStage } from './WebinarStage';

const START = '2026-10-25T15:00:00.000Z';

async function setup(role: WebinarViewerRole = 'attendee', status: 'published' | 'live' = 'live') {
  const server = new FakeWebinarServer({ status });
  const controller = new FakeCallSessionController({ role, format: 'webinar' });
  await controller.join();
  const client = new FakeWebinarClient({ server, role, name: role === 'attendee' ? 'Ana Kovač (sample)' : 'Mila', audio: controller });
  return { server, controller, client };
}

function renderStage(props: Partial<Parameters<typeof WebinarStage>[0]> & Pick<Parameters<typeof WebinarStage>[0], 'controller' | 'client'>) {
  return renderWithI18n(
    <WebinarStage title="Short breaks that work (sample)" presenterNames={['Marko']} startsAt={START} timeZone="Europe/Belgrade" onLeave={vi.fn()} {...props} />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WebinarStage (WBN-06 to WBN-08, WBN-16 to WBN-19, WBN-28)', () => {
  it("renders the presenter's video and puts a shared screen in the main view", async () => {
    const { controller, client } = await setup();
    const bind = vi.spyOn(controller, 'bindVideoTile');
    renderStage({ controller, client });
    expect(screen.getByText(t('webinar.waitingForVideo'))).toBeInTheDocument();

    let tileId = 0;
    act(() => {
      tileId = controller.simulate.remoteJoined('presenter-attendee');
    });
    const video = screen.getByLabelText(t('webinar.presenterVideo'));
    expect(video.tagName).toBe('VIDEO');
    expect(bind).toHaveBeenCalledWith(tileId, video);

    act(() => controller.simulate.contentShared(true));
    expect(screen.getByLabelText(t('stage.sharedScreen'))).toBeInTheDocument();
    expect(within(await screen.findByTestId('webinar-presenter-pip')).getByLabelText(t('webinar.presenterVideo'))).toBeInTheDocument();
  });

  it('shows the REC indicator while recording, announces it, and animates it out when recording stops', async () => {
    const { server, controller, client } = await setup();
    renderStage({ controller, client });
    expect(screen.queryByTestId('webinar-rec-indicator')).toBeNull();

    act(() => server.simulate.recording('started'));
    const indicator = screen.getByTestId('webinar-rec-indicator');
    expect(indicator).toHaveTextContent(t('webinar.recIndicator'));
    expect(indicator).toHaveTextContent(t('webinar.recording'));
    await waitFor(() => expect(screen.getByTestId('webinar-stage-announcer')).toHaveTextContent(t('webinar.recordingStarted')));

    act(() => server.simulate.recording('stopped'));
    expect(screen.queryByTestId('webinar-rec-indicator')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('webinar-rec-indicator')).toBeNull());
    expect(screen.getByTestId('webinar-stage-announcer')).toHaveTextContent(t('webinar.recordingStopped'));
  });

  it('updates the attendee count for hosts on the join event, as a number only', async () => {
    const { server, controller, client } = await setup('moderator');
    renderStage({ controller, client });
    expect(screen.getByTestId('webinar-stage-attendance')).toHaveTextContent(t('webinar.attendance', { count: 0 }));
    act(() => server.simulate.attendance(1));
    expect(screen.getByTestId('webinar-stage-attendance')).toHaveTextContent(t('webinar.attendance', { count: 1 }));
    act(() => server.simulate.attendance(26));
    expect(screen.getByTestId('webinar-stage-attendance')).toHaveTextContent(t('webinar.attendance', { count: 27 }));
    expect(screen.getByTestId('webinar-host-controls')).toBeInTheDocument();
  });

  it('gives attendees no camera control, no roster and no count (WBN-07, WBN-08, D-CW-35)', async () => {
    const { server, controller, client } = await setup();
    const { container } = renderStage({ controller, client });
    act(() => server.simulate.attendance(30));
    const controls = screen.getByTestId('webinar-attendee-controls');
    expect(within(controls).queryByRole('button', { name: new RegExp(`${t('controls.cameraOn')}|${t('controls.cameraOff')}`) })).toBeNull();
    expect(within(controls).queryByRole('button', { name: t('controls.mute') })).toBeNull();
    expect(within(controls).getByRole('button', { name: t('webinar.muteSound') })).toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: t('webinar.hand.raise') })).toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: t('consultation.leave') })).toBeInTheDocument();
    expect(screen.queryByTestId('webinar-stage-stats')).toBeNull();
    expect(container).not.toHaveTextContent('30');
    await expectNoA11yViolations(container);
  });

  it('mutes the webinar sound on this device and announces it', async () => {
    const user = userEvent.setup();
    const { controller, client } = await setup();
    const { container } = renderStage({ controller, client });
    const audio = container.querySelector('audio') as HTMLAudioElement;
    await user.click(screen.getByRole('button', { name: t('webinar.muteSound') }));
    expect(audio.muted).toBe(true);
    expect(screen.getByTestId('webinar-controls-announcer')).toHaveTextContent(t('webinar.soundMuted'));
    await user.click(screen.getByRole('button', { name: t('webinar.unmuteSound') }));
    expect(audio.muted).toBe(false);
  });

  it('enables the microphone only with the floor and after the notice was read', async () => {
    const user = userEvent.setup();
    const { server, controller, client } = await setup();
    renderStage({ controller, client });
    expect(screen.queryByTestId('webinar-floor-microphone')).toBeNull();

    act(() => void server.simulate.floorGiven(client.getSnapshot().participantId!));
    await screen.findByRole('dialog', { name: t('webinar.floorDialog.title') });
    const microphone = within(screen.getByTestId('webinar-floor-microphone')).getByRole('button', { name: t('controls.unmute'), hidden: true });
    expect(microphone).toBeDisabled();
    expect(microphone).toHaveAccessibleDescription(t('webinar.microphoneLocked'));
    await waitFor(() => expect(screen.getByTestId('webinar-stage-announcer')).toHaveTextContent(t('webinar.floorGiven')));

    await user.click(screen.getByRole('button', { name: t('webinar.floorDialog.later') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(microphone).toBeEnabled();
    await user.click(microphone);
    expect(controller.getSnapshot().media.muted).toBe(false);

    act(() => void server.simulate.floorTaken(client.getSnapshot().participantId!));
    expect(await screen.findByTestId('webinar-floor-taken-notice')).toHaveTextContent(t('webinar.floorTaken'));
    await waitFor(() => expect(screen.queryByTestId('webinar-floor-microphone')).toBeNull());
    expect(controller.getSnapshot().media.muted).toBe(true);
  });

  it('shows the lobby with countdown and notices until the webinar goes live', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T14:55:00.000Z'));
    const { server, controller, client } = await setup('attendee', 'published');
    const { container } = renderStage({ controller, client });
    const lobby = screen.getByTestId('webinar-lobby');
    expect(lobby).toHaveTextContent('Short breaks that work (sample)');
    expect(lobby).toHaveTextContent(t('webinar.presenters', { names: 'Marko' }));
    expect(screen.getByTestId('webinar-lobby-countdown')).toHaveTextContent(t('webinar.startsIn', { time: '05:00' }));
    expect(lobby).toHaveTextContent(t('webinar.recordingNotice'));
    expect(lobby).toHaveTextContent(t('webinar.lobby'));
    expect(lobby).toHaveTextContent(t('webinar.lobbyFloorRecording'));
    expect(screen.queryByTestId('webinar-attendee-controls')).toBeNull();
    await expectNoA11yViolations(container);

    act(() => server.simulate.start());
    expect(screen.queryByTestId('webinar-lobby')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('webinar-lobby')).toBeNull());
    expect(screen.getByTestId('webinar-stage-announcer')).toHaveTextContent(t('webinar.started'));
    expect(screen.getByTestId('webinar-attendee-controls')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('webinar.endForEveryone') })).toBeNull();
  });

  it('offers hosts "Start webinar" in the lobby and renders an outside error', async () => {
    const user = userEvent.setup();
    const { controller, client } = await setup('presenter', 'published');
    const onStart = vi.fn();
    renderStage({ controller, client, onStart, error: t('errors.webinarNotOpen') });
    await user.click(within(screen.getByTestId('webinar-lobby')).getByRole('button', { name: t('webinar.start') }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent(t('errors.webinarNotOpen'));
    expect(screen.getByTestId('webinar-share-screen')).toHaveTextContent(t('controls.shareScreen'));
  });

  it('shows "a participant is speaking" to everyone while an attendee has the floor (WBN-25.8)', async () => {
    const { server, controller, client } = await setup();
    renderStage({ controller, client });
    expect(screen.queryByTestId('webinar-floor-active')).toBeNull();
    act(() => void server.simulate.floorGiven('sample-participant-other'));
    const badge = screen.getByTestId('webinar-floor-active');
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveTextContent(t('webinar.participantSpeaking'));
    act(() => void server.simulate.floorTaken('sample-participant-other'));
    expect(screen.queryByTestId('webinar-floor-active')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('webinar-floor-active')).toBeNull());
  });

  it('locks the microphone and says so while a host has muted the attendee (WBN-26)', async () => {
    const { server, controller, client } = await setup();
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    moderator.connect();
    renderStage({ controller, client });
    const participantId = client.getSnapshot().participantId!;
    await act(() => moderator.giveFloor(participantId));
    act(() => client.acknowledgeFloor());
    await act(() => moderator.muteSpeaker(participantId));
    expect(await screen.findByTestId('webinar-muted-by-host')).toHaveTextContent(t('webinar.mutedByHost'));
    const microphone = within(screen.getByTestId('webinar-floor-microphone')).getByRole('button', { hidden: true });
    expect(microphone).toBeDisabled();
    expect(microphone).toHaveAccessibleDescription(t('webinar.mutedByHost'));
    await act(() => moderator.requestUnmute(participantId));
    expect(await screen.findByRole('dialog', { name: t('webinar.unmuteRequest.title') })).toBeInTheDocument();
  });

  it('tells an attendee with the floor that the microphone is blocked', async () => {
    const { server, controller, client } = await setup();
    renderStage({ controller, client });
    act(() => void server.simulate.floorGiven(client.getSnapshot().participantId!));
    act(() => controller.simulate.microphonePermission('denied'));
    expect(within(await screen.findByTestId('webinar-controls-error')).getByRole('alert')).toHaveTextContent(t('webinar.errors.microphoneUnavailable'));
  });

  it('lets a host end the webinar for everyone after a confirmation; attendees have no such control', async () => {
    const user = userEvent.setup();
    const { server, controller, client } = await setup('presenter');
    const attendee = new FakeWebinarClient({ server, role: 'attendee' });
    attendee.connect();
    const onEnd = vi.fn();
    renderStage({ controller, client, onEnd });

    await user.click(screen.getByRole('button', { name: t('webinar.endForEveryone') }));
    const dialog = await screen.findByRole('alertdialog', { name: t('webinar.endConfirmTitle') });
    expect(dialog).toHaveAccessibleDescription(t('webinar.endConfirmBody'));
    await user.click(within(dialog).getByRole('button', { name: t('webinar.keepGoing') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(server.requests.some((request) => request.action === 'webinar.end')).toBe(false);

    await user.click(screen.getByRole('button', { name: t('webinar.endForEveryone') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('webinar.endForEveryone') }));
    await waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(attendee.getSnapshot().status).toBe('ended');
    expect(await screen.findByTestId('webinar-ended')).toBeInTheDocument();
  });

  it('shows a failed end on the stage and keeps the webinar going', async () => {
    const user = userEvent.setup();
    const { server, controller, client } = await setup('moderator');
    server.simulate.failNext('webinar.end', 'network');
    const onEnd = vi.fn();
    renderStage({ controller, client, onEnd });
    await user.click(screen.getByRole('button', { name: t('webinar.endForEveryone') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('webinar.endForEveryone') }));
    expect(await screen.findByTestId('webinar-stage-error')).toHaveTextContent(t('errors.network'));
    expect(onEnd).not.toHaveBeenCalled();
    expect(client.getSnapshot().status).toBe('live');
  });

  it('tells hosts, and only hosts, that the recording failed (CW-R-121)', async () => {
    const { server, controller, client } = await setup('moderator');
    const attendee = await setup();
    renderStage({ controller, client });
    act(() => server.simulate.recording('started'));
    expect(screen.queryByTestId('webinar-recording-failed')).toBeNull();
    act(() => server.simulate.recording('failed'));
    expect(screen.getByTestId('webinar-recording-failed')).toHaveTextContent(t('webinar.recordingFailed'));
    expect(screen.queryByTestId('webinar-rec-indicator')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('webinar-rec-indicator')).toBeNull());

    const other = renderStage({ controller: attendee.controller, client: attendee.client });
    act(() => attendee.server.simulate.recording('failed'));
    expect(within(other.container).queryByTestId('webinar-recording-failed')).toBeNull();
  });

  it('leaves the meeting and says so when the webinar ends', async () => {
    const { server, controller, client } = await setup();
    renderStage({ controller, client });
    act(() => server.simulate.end());
    expect(await screen.findByTestId('webinar-ended')).toHaveTextContent(t('webinar.ended'));
    await waitFor(() => expect(controller.getSnapshot().session.status).toBe('left'));
    expect(screen.queryByTestId('webinar-attendee-controls')).toBeNull();
  });
});
