import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Skeleton label="Loading content" />
      <Skeleton lines={1} label="Loading single line" />
      <Skeleton lines={5} label="Loading many lines" />
    </div>
  ),
};
