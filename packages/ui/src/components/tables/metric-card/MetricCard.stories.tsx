import type { Meta, StoryObj } from '@storybook/react-vite';
import { MetricCard } from './MetricCard';

const meta: Meta<typeof MetricCard> = {
  title: 'Tables/MetricCard',
  component: MetricCard,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <dl className="grid grid-cols-3 gap-6">
      <MetricCard label="Active employees" value="142" />
      <MetricCard label="Sessions this month" value="38" hint="+12% from last month" />
      <MetricCard label="Satisfaction" value="4.8" hint="out of 5.0" />
    </dl>
  ),
};
