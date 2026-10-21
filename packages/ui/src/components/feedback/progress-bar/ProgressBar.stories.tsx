import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProgressBar } from './ProgressBar';

const meta: Meta<typeof ProgressBar> = {
  title: 'Feedback/ProgressBar',
  component: ProgressBar,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-6 max-w-md">
      <ProgressBar value={0} label="Not started" showValue />
      <ProgressBar value={33} label="In progress" showValue />
      <ProgressBar value={75} label="Almost there" showValue />
      <ProgressBar value={100} label="Complete" showValue />
      <ProgressBar value={50} label="Without value text" />
    </div>
  ),
};
