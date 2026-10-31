import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnimatePresence, Button, MotionFeatures } from '@nestself/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BrowserFamily } from '../environment';
import { withCallsI18n } from '../stories/decorators';
import { FakeCallSessionController } from '../testing/fake-controller';
import type { FakeCallSessionControllerOptions } from '../testing/fake-controller';
import { PreJoinCheck } from './PreJoinCheck';

const meta: Meta<typeof PreJoinCheck> = {
  title: 'Video/PreJoinCheck',
  component: PreJoinCheck,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof PreJoinCheck>;

interface DemoProps {
  options?: FakeCallSessionControllerOptions;
  browser?: BrowserFamily;
  withError?: boolean;
}

/**
 * A fake controller: the check, the devices and the preview are simulated
 * and no meeting is joined. "Join" only toggles the panel away so its exit
 * animation can be seen.
 */
function Demo({ options, browser = 'chrome', withError = false }: DemoProps) {
  const { t } = useTranslation('calls');
  const [controller] = useState(() => new FakeCallSessionController({ delayMs: 900, ...options }));
  const [open, setOpen] = useState(true);
  return (
    <div className="gap-4 flex flex-col items-start">
      <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide the check (story only)' : 'Show the check (story only)'}
      </Button>
      <MotionFeatures>
        <AnimatePresence>
          {open ? (
            <PreJoinCheck
              key="prejoin"
              controller={controller}
              browser={browser}
              error={withError ? t('errors.joinWindowClosed') : null}
              onJoin={() => setOpen(false)}
            />
          ) : null}
        </AnimatePresence>
      </MotionFeatures>
    </div>
  );
}

export const Default: Story = { render: () => <Demo /> };

/** The browser blocked the microphone: browser help, Check again, Join disabled (CALL-03). */
export const MicrophoneBlocked: Story = { render: () => <Demo options={{ readiness: { microphone: 'denied' } }} /> };

/** A blocked camera alone still lets the person join with the camera off. */
export const CameraBlockedFirefox: Story = { render: () => <Demo browser="firefox" options={{ readiness: { camera: 'denied' } }} /> };

export const PoorNetwork: Story = { render: () => <Demo options={{ readiness: { network: 'poor' } }} /> };

export const BlurUnavailable: Story = { render: () => <Demo options={{ blurSupported: false }} /> };

/** Webinar attendees: no camera preview, camera toggle or blur (CW-R-124). */
export const WebinarAttendee: Story = { render: () => <Demo options={{ role: 'attendee', format: 'webinar' }} /> };

export const JoinError: Story = { render: () => <Demo withError /> };

export const Serbian: Story = { render: () => <Demo />, parameters: { locale: 'sr-Latn' } };

export const Hungarian: Story = { render: () => <Demo />, parameters: { locale: 'hu' } };
