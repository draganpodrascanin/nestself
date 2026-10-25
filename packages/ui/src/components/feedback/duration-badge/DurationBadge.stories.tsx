import type { Meta, StoryObj } from '@storybook/react-vite';
import { DurationBadge } from './DurationBadge';

const meta: Meta<typeof DurationBadge> = {
  title: 'Feedback/DurationBadge',
  component: DurationBadge,
};
export default meta;

export const FiveMinutes: StoryObj<typeof DurationBadge> = {
  args: { durationSeconds: 300 },
};

export const SubMinute: StoryObj<typeof DurationBadge> = {
  args: { durationSeconds: 30 },
};

export const BandLabel: StoryObj<typeof DurationBadge> = {
  args: { bandLabel: 'Under 5 min' },
};

export const TenMinutes: StoryObj<typeof DurationBadge> = {
  args: { durationSeconds: 600 },
};
