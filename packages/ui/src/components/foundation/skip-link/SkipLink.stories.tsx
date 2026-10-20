import type { Meta, StoryObj } from '@storybook/react-vite';
import { SkipLink } from './SkipLink';

const meta: Meta<typeof SkipLink> = {
  title: 'Foundation/SkipLink',
  component: SkipLink,
};
export default meta;

export const Default: StoryObj<typeof SkipLink> = {
  args: { children: 'Skip to main content' },
};
