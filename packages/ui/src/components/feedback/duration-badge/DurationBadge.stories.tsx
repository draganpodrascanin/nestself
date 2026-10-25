import type { Meta, StoryObj } from '@storybook/react-vite';
import { DurationBadge } from './DurationBadge';

const fmt = (s: number) => {
  const m = Math.round(s / 60);
  return m < 1 ? '<1 min' : `${m} min`;
};

const meta: Meta<typeof DurationBadge> = {
  title: 'Feedback/DurationBadge',
  component: DurationBadge,
  args: { formatLabel: fmt },
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

export const CustomFormatter: StoryObj<typeof DurationBadge> = {
  args: {
    durationSeconds: 300,
    formatLabel: (s: number) => `${Math.round(s / 60)} perc`,
  },
};
