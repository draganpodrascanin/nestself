import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CallParticipantRole } from '@nestself/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withCallsI18n } from '../stories/decorators';
import type { BlurState } from '../types';
import { ControlBar } from './ControlBar';

const meta: Meta<typeof ControlBar> = {
  title: 'Video/ControlBar',
  component: ControlBar,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof ControlBar>;

const DEVICES = {
  cameras: [
    { deviceId: 'cam-1', label: 'Built-in camera (sample)' },
    { deviceId: 'cam-2', label: 'USB camera (sample)' },
  ],
  microphones: [
    { deviceId: 'mic-1', label: 'Built-in microphone (sample)' },
    { deviceId: 'mic-2', label: 'Headset microphone (sample)' },
  ],
  speakers: [{ deviceId: 'spk-1', label: 'Built-in speakers (sample)' }],
};

interface PlaygroundProps {
  participantRole: CallParticipantRole;
  blurSupported?: boolean;
  withError?: boolean;
}

/** Stateful bar: every control works locally; nothing is sent anywhere. */
function Playground({ participantRole, blurSupported = true, withError = false }: PlaygroundProps) {
  const { t } = useTranslation('calls');
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(participantRole !== 'attendee');
  const [blur, setBlur] = useState<BlurState>({ supported: blurSupported ? true : false, enabled: false, loading: false });
  const [sharing, setSharing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selected, setSelected] = useState({ camera: 'cam-1', microphone: 'mic-1', speaker: 'spk-1' });
  const [ended, setEnded] = useState(false);
  return (
    <div className="gap-4 flex flex-col items-center">
      <ControlBar
        participantRole={participantRole}
        muted={muted}
        cameraOn={cameraOn}
        blur={blur}
        sharingScreen={sharing}
        fullscreen={fullscreen}
        devices={{ ...DEVICES, selected }}
        error={withError ? t('errors.unknown') : null}
        onToggleMute={() => setMuted((value) => !value)}
        onToggleCamera={() => setCameraOn((value) => !value)}
        onToggleBlur={() => setBlur((value) => ({ ...value, enabled: !value.enabled }))}
        onSelectDevice={(kind, deviceId) => setSelected((value) => ({ ...value, [kind]: deviceId }))}
        onToggleFullscreen={() => setFullscreen((value) => !value)}
        onToggleScreenShare={participantRole === 'expert' ? () => setSharing((value) => !value) : undefined}
        onSignal={() => undefined}
        onLeave={() => undefined}
        onEndForEveryone={participantRole === 'expert' ? () => setEnded(true) : undefined}
      />
      {ended ? <p className="type-metadata text-text-secondary">Story only: the call would end here; nothing was sent.</p> : null}
    </div>
  );
}

export const Employee: Story = { render: () => <Playground participantRole="employee" /> };

/** Screen sharing and "end for everyone" (with confirmation) are the expert's. */
export const Expert: Story = { render: () => <Playground participantRole="expert" /> };

/** Webinar attendees never get a camera control (D-CW-35). */
export const WebinarAttendee: Story = { render: () => <Playground participantRole="attendee" /> };

export const BlurUnavailable: Story = { render: () => <Playground participantRole="employee" blurSupported={false} /> };

export const WithError: Story = {
  render: () => <Playground participantRole="employee" withError />,
};

/** At 390 px secondary controls collapse into "More" (UX-20); narrow the viewport to see it. */
export const Narrow: Story = {
  render: () => (
    <div className="mx-auto w-[390px] max-w-full">
      <Playground participantRole="employee" />
    </div>
  ),
};

export const Serbian: Story = { render: () => <Playground participantRole="expert" />, parameters: { locale: 'sr-Latn' } };
