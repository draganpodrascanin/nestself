import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@nestself/ui';
import { useState } from 'react';
import { withCallsI18n } from '../stories/decorators';
import type { ConnectionQuality } from '../quality-thresholds';
import { ConnectionBadge } from './ConnectionBadge';

const meta: Meta<typeof ConnectionBadge> = {
  title: 'Video/ConnectionBadge',
  component: ConnectionBadge,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof ConnectionBadge>;

export const Good: Story = { args: { quality: 'good' } };
export const Degraded: Story = { args: { quality: 'degraded' } };
export const Poor: Story = { args: { quality: 'poor' } };
export const VideoPaused: Story = { args: { quality: 'poor', videoPaused: true } };
export const Reconnecting: Story = { args: { quality: 'poor', reconnecting: true } };

type State = { quality: ConnectionQuality; videoPaused?: boolean; reconnecting?: boolean };
const SEQUENCE: Array<{ label: string; state: State }> = [
  { label: 'Good', state: { quality: 'good' } },
  { label: 'Degraded', state: { quality: 'degraded' } },
  { label: 'Poor', state: { quality: 'poor' } },
  { label: 'Video paused', state: { quality: 'poor', videoPaused: true } },
  { label: 'Reconnecting', state: { quality: 'poor', reconnecting: true } },
];

function Cycle() {
  const [state, setState] = useState<State>({ quality: 'good' });
  return (
    <div className="gap-4 flex flex-col items-start">
      <div className="gap-2 flex flex-wrap">
        {SEQUENCE.map((step) => (
          <Button key={step.label} size="sm" variant="secondary" onClick={() => setState(step.state)}>
            {step.label}
          </Button>
        ))}
      </div>
      <ConnectionBadge {...state} />
    </div>
  );
}

/** Switch states to see the banner animate in and out (motion suite entry). */
export const Transitions: Story = { render: () => <Cycle /> };
