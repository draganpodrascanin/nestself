import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CallParticipantRole } from '@nestself/contracts';
import { useEffect, useRef, useState } from 'react';
import { useCallSession } from '../hooks/useCallSession';
import { useConnectionQuality } from '../hooks/useConnectionQuality';
import { useDevices } from '../hooks/useDevices';
import { useFullscreen } from '../hooks/useFullscreen';
import { withCallsI18n } from '../stories/decorators';
import { FakeCallSessionController } from '../testing/fake-controller';
import { CallStage } from './CallStage';
import { ConnectionBadge } from './ConnectionBadge';
import { ControlBar } from './ControlBar';
import { CrisisResourcesButton } from './CrisisBlock';
import { SessionTimer } from './SessionTimer';

const meta: Meta<typeof CallStage> = {
  title: 'Video/CallStage',
  component: CallStage,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof CallStage>;

const MINUTE = 60_000;
const at = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();

type Scene = 'connected' | 'waiting' | 'shared' | 'reconnecting' | 'failed' | 'ended' | 'degraded';

/**
 * A full consultation screen on a fake controller: the videos are abstract
 * patterns, nothing joins a meeting and nothing is sent. The participant
 * name is a placeholder.
 */
function Consultation({ participantRole = 'employee', scene = 'connected' }: { participantRole?: CallParticipantRole; scene?: Scene }) {
  const [controller] = useState(() => new FakeCallSessionController({ role: participantRole }));
  const call = useCallSession(controller);
  const devices = useDevices(controller);
  const quality = useConnectionQuality(controller);
  const stageRef = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(stageRef);

  useEffect(() => {
    controller.simulate.connected({ startsAt: at(-38), endsAt: at(7) });
    void controller.refreshDevices();
    if (scene !== 'waiting') controller.simulate.remoteJoined();
    if (scene === 'shared') controller.simulate.contentShared(true);
    if (scene === 'reconnecting') controller.simulate.reconnecting();
    if (scene === 'degraded') controller.simulate.quality('poor', { videoPaused: true, lowResolution: true });
    if (scene === 'failed') controller.simulate.reconnectFailed();
    if (scene === 'ended') controller.simulate.ended();
  }, [controller, scene]);

  return (
    <div className="h-[40rem] w-full">
      <CallStage
        ref={stageRef}
        controller={controller}
        remoteName="Sample name"
        onRejoin={() => controller.simulate.connected()}
        supportHref="#support"
        header={
          <>
            <div className="gap-2 flex flex-col items-start">
              {call.startsAt && call.endsAt ? <SessionTimer startsAt={call.startsAt} endsAt={call.endsAt} participantRole={participantRole} /> : null}
              <ConnectionBadge quality={quality.level} reconnecting={quality.reconnecting} videoPaused={quality.videoPaused} />
            </div>
            <CrisisResourcesButton audience={participantRole === 'expert' ? 'expert' : 'employee'} />
          </>
        }
        controls={
          <ControlBar
            participantRole={participantRole}
            muted={call.media.muted}
            cameraOn={call.media.cameraOn}
            sharingScreen={call.media.sharingScreen}
            blur={devices.blur}
            devices={devices}
            fullscreen={fullscreen.isFullscreen}
            onToggleMute={call.toggleMute}
            onToggleCamera={() => void call.toggleCamera()}
            onToggleBlur={() => void devices.setBlur(!devices.blur.enabled)}
            onSelectDevice={(kind, deviceId) => void devices.selectDevice(kind, deviceId)}
            onToggleFullscreen={fullscreen.supported ? () => void fullscreen.toggle() : undefined}
            onToggleScreenShare={participantRole === 'expert' ? () => void call.toggleScreenShare() : undefined}
            onSignal={() => undefined}
            onLeave={() => void call.leave()}
            onEndForEveryone={participantRole === 'expert' ? () => controller.simulate.ended() : undefined}
          />
        }
      />
    </div>
  );
}

export const Connected: Story = { render: () => <Consultation /> };
export const ExpertView: Story = { render: () => <Consultation participantRole="expert" /> };
export const WaitingForTheOtherParticipant: Story = { render: () => <Consultation scene="waiting" /> };
export const SharedScreen: Story = { render: () => <Consultation scene="shared" /> };
export const DegradedConnection: Story = { render: () => <Consultation scene="degraded" /> };
export const Reconnecting: Story = { render: () => <Consultation scene="reconnecting" /> };
/** After 2 minutes without a connection: rejoin and contact support (CALL-10). */
export const ReconnectFailed: Story = { render: () => <Consultation scene="failed" /> };
export const EndedByExpert: Story = { render: () => <Consultation scene="ended" /> };

/** At 390 px the remote video fills the screen and the self-view floats (UX-20). */
export const Mobile: Story = {
  render: () => (
    <div className="mx-auto w-[390px] max-w-full">
      <Consultation />
    </div>
  ),
};
