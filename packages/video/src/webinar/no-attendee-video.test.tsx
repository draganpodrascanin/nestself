/**
 * D-CW-35, WBN-07.5, WBN-08.6, CW-R-124: attendees never send video. No code
 * path of the webinar client or of the webinar components an attendee sees
 * calls anything that would turn a camera on or ask for video capability.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { WEBINAR_PARTICIPANT_EVENT_NAMES } from '@nestself/contracts';
import { renderWithI18n, t } from '../test/i18n';
import { FakeCallSessionController } from '../testing/fake-controller';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import type { CallSessionControllerApi } from '../types';
import { WebinarStage } from '../components/WebinarStage';
import { ChatPanel } from '../components/ChatPanel';
import { PollPanel } from '../components/PollPanel';

const SRC = resolve(import.meta.dirname, '..');

/** Everything an attendee's webinar screen runs. Host-only media controls live in `WebinarStageHostControls.tsx`. */
const ATTENDEE_SOURCES = [
  ...readdirSync(join(SRC, 'webinar'))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(SRC, 'webinar', name)),
  join(SRC, 'hooks/useWebinarStage.ts'),
  join(SRC, 'testing/fake-webinar.ts'),
  ...[
    'WebinarStage.tsx',
    'WebinarStageAttendeeControls.tsx',
    'WebinarStageParts.tsx',
    'WebinarStageHooks.ts',
    'ChatPanel.tsx',
    'ChatPanelMessage.tsx',
    'PollPanel.tsx',
    'ModeratorQueue.tsx',
    'HandRaiseButton.tsx',
    'FloorGrantedDialog.tsx',
  ].map((name) => join(SRC, 'components', name)),
];

/** Calls and values that send video or ask for it. */
const VIDEO_SEND =
  /\b(setCameraOn|setCameraOff|cameraOn|cameraOff|toggleCamera|setBlur|bindPreview|canSendVideo|startVideoInput|startLocalVideoTile|VideoCamera\w*)\b|selectDevice\(\s*['"]camera|video:\s*['"]send|Video:\s*['"]Send/;

/** Controller methods an attendee's webinar screen may use: rendering received media, the mute and the floor's audio. */
const ALLOWED = new Set(['getSnapshot', 'subscribe', 'bindAudio', 'bindVideoTile', 'unbindVideoTile', 'setMuted', 'setAudioCapability', 'leave']);
const FORBIDDEN = ['setCameraOn', 'setCameraOff', 'setBlur', 'bindPreview', 'setScreenShare', 'selectDevice', 'checkReadiness'];

function recording(target: FakeCallSessionController) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const proxy = new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object);
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      return (...args: unknown[]) => {
        calls.push({ method: property, args });
        return (value as (...a: unknown[]) => unknown).apply(object, args);
      };
    },
  });
  return { controller: proxy as unknown as CallSessionControllerApi, calls };
}

describe('attendees never send video (D-CW-35)', () => {
  it('no attendee-facing webinar source mentions a camera or a video send capability', () => {
    expect(ATTENDEE_SOURCES.length).toBeGreaterThan(12);
    const offenders = ATTENDEE_SOURCES.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file: relative(SRC, file), line: index + 1, text: line }))
        .filter((entry) => VIDEO_SEND.test(entry.text)),
    );
    expect(offenders).toEqual([]);
    // The pattern does catch camera code: the hosts' controls, never rendered for an attendee, match it.
    expect(VIDEO_SEND.test(readFileSync(join(SRC, 'components/WebinarStageHostControls.tsx'), 'utf8'))).toBe(true);
  });

  it('the whole attendee flow touches only audio and received media on the controller', async () => {
    const user = userEvent.setup();
    const server = new FakeWebinarServer({ status: 'published' });
    const fake = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
    await fake.join();
    const { controller, calls } = recording(fake);
    const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana (sample)', audio: controller });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    moderator.connect();
    const participantId = attendee.getSnapshot().participantId!;

    renderWithI18n(
      <>
        <WebinarStage controller={controller} client={attendee} title="Sample webinar" startsAt="2026-10-25T15:00:00.000Z" onLeave={vi.fn()} />
        <ChatPanel client={attendee} />
        <PollPanel client={attendee} />
      </>,
    );
    act(() => {
      server.simulate.start();
      fake.simulate.remoteJoined('presenter');
    });
    const controls = await screen.findByTestId('webinar-attendee-controls');
    await user.click(within(controls).getByRole('button', { name: t('webinar.muteSound') }));
    await user.click(within(controls).getByRole('button', { name: t('webinar.hand.raise') }));
    await waitFor(() => expect(moderator.getSnapshot().hands).toHaveLength(1));

    await act(() => moderator.giveFloor(participantId));
    await user.click(await screen.findByRole('button', { name: t('webinar.floorDialog.unmute') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(within(screen.getByTestId('webinar-floor-microphone')).getByRole('button', { name: t('controls.mute') }));
    await act(() => moderator.takeFloor(participantId));
    await waitFor(() => expect(fake.getSnapshot().devices.canSendAudio).toBe(false));
    act(() => server.simulate.end());
    await waitFor(() => expect(fake.getSnapshot().session.status).toBe('left'));

    const used = new Set(calls.map((call) => call.method));
    expect([...used].filter((method) => !ALLOWED.has(method))).toEqual([]);
    for (const method of FORBIDDEN) expect(used.has(method)).toBe(false);
    expect(calls.filter((call) => call.method === 'setAudioCapability').map((call) => call.args)).toEqual([[true], [false]]);
    expect(fake.getSnapshot().devices.canSendVideo).toBe(false);
    expect(fake.getSnapshot().media.cameraOn).toBe(false);
    expect(fake.getSnapshot().tiles.localTileId).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`${t('controls.cameraOn')}|${t('controls.cameraOff')}`) })).toBeNull();

    const floorEvents = server.emitted.filter((entry) => (WEBINAR_PARTICIPANT_EVENT_NAMES as readonly string[]).includes(entry.event));
    expect(floorEvents).toHaveLength(2);
    for (const entry of floorEvents) expect(entry.payload).toMatchObject({ capabilities: { video: 'receive', content: 'receive' } });
  });
});
