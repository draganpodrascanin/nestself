import type { Meta, StoryObj } from '@storybook/react-vite';
import { SampleDataBanner } from './SampleDataBanner';

const meta: Meta<typeof SampleDataBanner> = {
  title: 'Patterns/SampleDataBanner',
  component: SampleDataBanner,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <SampleDataBanner message="This is sample data for demonstration purposes only." />
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <SampleDataBanner message="This is sample data for demonstration purposes only." />
      <SampleDataBanner message="All names, amounts, and dates shown are fictional." />
    </div>
  ),
};
