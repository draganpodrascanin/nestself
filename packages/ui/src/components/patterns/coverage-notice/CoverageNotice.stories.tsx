import type { Meta, StoryObj } from '@storybook/react-vite';
import { CoverageNotice } from './CoverageNotice';

const meta: Meta<typeof CoverageNotice> = {
  title: 'Patterns/CoverageNotice',
  component: CoverageNotice,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <CoverageNotice>Know your coverage before you confirm.</CoverageNotice>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-md">
      <CoverageNotice>Know your coverage before you confirm.</CoverageNotice>
      <CoverageNotice>Your employer covers 100% of this service.</CoverageNotice>
    </div>
  ),
};
