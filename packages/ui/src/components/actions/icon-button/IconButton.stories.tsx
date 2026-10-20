import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconButton } from './IconButton';
import { Heart, X, GearSix } from '@phosphor-icons/react';

const meta: Meta<typeof IconButton> = {
  title: 'Actions/IconButton',
  component: IconButton,
};
export default meta;

export const Default: StoryObj<typeof IconButton> = {
  args: { label: 'Favourite', icon: <Heart size={20} /> },
};

export const Variants: StoryObj = {
  render: () => (
    <div className="flex gap-3">
      <IconButton label="Primary" icon={<Heart size={20} />} variant="primary" />
      <IconButton label="Secondary" icon={<X size={20} />} variant="secondary" />
      <IconButton label="Ghost" icon={<GearSix size={20} />} variant="ghost" />
      <IconButton label="Danger" icon={<X size={20} />} variant="danger" />
    </div>
  ),
};
