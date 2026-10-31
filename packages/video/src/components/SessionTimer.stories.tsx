import type { Meta, StoryObj } from '@storybook/react-vite';
import { withCallsI18n } from '../stories/decorators';
import { SessionTimer } from './SessionTimer';

const MINUTE = 60_000;
/** ISO time relative to when the story module loaded. */
const at = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();

const meta: Meta<typeof SessionTimer> = {
  title: 'Video/SessionTimer',
  component: SessionTimer,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof SessionTimer>;

export const Running: Story = { args: { startsAt: at(-15), endsAt: at(30), participantRole: 'employee' } };

/** The dismissable five-minute cue (motion suite entry). */
export const FiveMinutesLeft: Story = { args: { startsAt: at(-40), endsAt: at(4.5), participantRole: 'employee' } };

/** The expert's cue adds the follow-up reminder (D-CW-37). */
export const FiveMinutesLeftExpert: Story = { args: { startsAt: at(-40), endsAt: at(4.5), participantRole: 'expert' } };

export const TimeEnded: Story = { args: { startsAt: at(-46), endsAt: at(-1), participantRole: 'employee' } };

export const RoomClosing: Story = { args: { startsAt: at(-56), endsAt: at(-11), participantRole: 'employee' } };

export const Serbian: Story = {
  args: { startsAt: at(-40), endsAt: at(4.5), participantRole: 'expert' },
  parameters: { locale: 'sr-Latn' },
};
