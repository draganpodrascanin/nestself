import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withCallsI18n } from '../stories/decorators';
import { FakeCallSessionController } from '../testing/fake-controller';
import { FakeWebinarClient } from '../testing/fake-webinar';
import { FAKE_WEBINAR_SAMPLE_PEOPLE, createSampleWebinarServer } from '../testing/fake-webinar-sample';
import type { WebinarViewerRole } from '../webinar/types';
import { ChatPanel } from './ChatPanel';
import { ModeratorQueue } from './ModeratorQueue';
import { PollPanel } from './PollPanel';
import { WebinarStage } from './WebinarStage';

const meta: Meta<typeof WebinarStage> = {
  title: 'Video/WebinarStage',
  component: WebinarStage,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof WebinarStage>;

const MINUTE = 60_000;
const at = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();

type Scene = 'live' | 'lobby' | 'shared' | 'floor' | 'ended' | 'notRecording';

interface DemoProps {
  viewer?: WebinarViewerRole;
  scene?: Scene;
  /** Chat, polls and, for hosts, the moderation queue beside the stage. */
  panels?: boolean;
}

/**
 * A webinar screen on a fake call and a fake webinar: videos are abstract
 * patterns, the people are placeholders, nothing joins a meeting and nothing
 * is sent.
 */
function Webinar({ viewer: role = 'attendee', scene = 'live', panels = false }: DemoProps) {
  const { t } = useTranslation('calls');
  const [startsAt] = useState(() => at(scene === 'lobby' ? 12 : -20));
  const [setup] = useState(() => {
    const live = scene !== 'lobby';
    const server = createSampleWebinarServer({
      status: live ? 'live' : 'published',
      pending: role === 'moderator',
      hands: role !== 'attendee',
      poll: panels ? 'open' : 'none',
      attendance: 86,
      recording: live && scene !== 'notRecording',
      delayMs: 300,
    });
    const controller = new FakeCallSessionController({ role, format: 'webinar' });
    const [ana] = FAKE_WEBINAR_SAMPLE_PEOPLE.attendees;
    const client =
      role === 'attendee'
        ? new FakeWebinarClient({ server, role, participantId: ana.participantId, name: ana.name, audio: controller })
        : new FakeWebinarClient({ server, role, name: role === 'moderator' ? FAKE_WEBINAR_SAMPLE_PEOPLE.moderator : FAKE_WEBINAR_SAMPLE_PEOPLE.presenter, audio: controller });
    return { server, controller, client, participantId: ana.participantId };
  });
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const { server, controller, participantId } = setup;
    controller.simulate.connected({ startsAt, endsAt: at(40) });
    void controller.refreshDevices();
    if (scene !== 'lobby') controller.simulate.remoteJoined('sample-presenter');
    if (scene === 'shared') controller.simulate.contentShared(true);
    if (scene === 'floor') server.simulate.floorGiven(participantId);
    if (scene === 'ended') server.simulate.end();
  }, [setup, scene, startsAt]);

  const stage = (
    <WebinarStage
      controller={setup.controller}
      client={setup.client}
      title="Short breaks that work (sample)"
      presenterNames={[FAKE_WEBINAR_SAMPLE_PEOPLE.presenter]}
      startsAt={startsAt}
      timeZone="Europe/Belgrade"
      onLeave={() => void setup.controller.leave()}
      onStart={
        role === 'attendee'
          ? undefined
          : () => {
              setStarted(true);
              setup.server.simulate.start();
            }
      }
      startPending={started && setup.client.getSnapshot().status !== 'live'}
    />
  );

  return (
    <div className="gap-3 flex flex-col">
      {panels ? (
        <div className="gap-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="h-[40rem]">{stage}</div>
          <div className="gap-4 flex flex-col">
            {role === 'attendee' ? null : <ModeratorQueue client={setup.client} />}
            <PollPanel client={setup.client} />
            <ChatPanel client={setup.client} className="h-[28rem]" />
          </div>
        </div>
      ) : (
        <div className="h-[40rem] w-full">{stage}</div>
      )}
      <p className="type-metadata text-text-secondary">{t('sample.actionNoop')}</p>
    </div>
  );
}

/** The presenter's video only: no roster, no names, no counts and no camera control (WBN-07, WBN-08). */
export const AttendeeLive: Story = { render: () => <Webinar /> };
/** Before the start: title, presenter, start time, countdown, the recording notice and the lobby notice (WBN-06). */
export const AttendeeLobby: Story = { render: () => <Webinar scene="lobby" /> };
export const AttendeeSharedScreen: Story = { render: () => <Webinar scene="shared" /> };
/** A host gave the floor: "You can speak now. Unmute to talk." with the recording notice (CW-R-125). */
export const AttendeeWithTheFloor: Story = { render: () => <Webinar scene="floor" /> };
export const AttendeeEnded: Story = { render: () => <Webinar scene="ended" /> };
export const AttendeeNotRecording: Story = { render: () => <Webinar scene="notRecording" /> };
/** The full attendee screen with the chat and the open poll. */
export const AttendeeScreen: Story = { render: () => <Webinar panels /> };
/** The presenter in the lobby with "Start webinar" (WBN-16, WBN-17). */
export const PresenterLobby: Story = { render: () => <Webinar viewer="presenter" scene="lobby" /> };
/** The presenter live: self-view, attendance count, hands and published messages, controls through ControlBar (WBN-18, WBN-19). */
export const PresenterLive: Story = { render: () => <Webinar viewer="presenter" /> };
/** The moderator's full screen: stage, queue, polls and chat. */
export const ModeratorScreen: Story = { render: () => <Webinar viewer="moderator" panels /> };
/** At 390 px the presenter fills the screen and the controls wrap with 44 px targets (UX-20). */
export const Mobile: Story = {
  render: () => (
    <div className="mx-auto w-[390px] max-w-full">
      <Webinar />
    </div>
  ),
};
export const SerbianLatin: Story = { render: () => <Webinar scene="lobby" />, parameters: { locale: 'sr-Latn' } };
export const SerbianCyrillic: Story = { render: () => <Webinar />, parameters: { locale: 'sr-Cyrl' } };
export const Hungarian: Story = { render: () => <Webinar scene="floor" />, parameters: { locale: 'hu' } };
