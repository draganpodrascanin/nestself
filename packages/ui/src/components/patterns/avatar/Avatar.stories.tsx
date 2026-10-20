import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';

const meta: Meta<typeof Avatar> = {
  title: 'Patterns/Avatar',
  component: Avatar,
};
export default meta;

export const Sizes: StoryObj = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar initials="SM" name="Small" size="sm" />
      <Avatar initials="MD" name="Medium" size="md" />
      <Avatar initials="LG" name="Large" size="lg" />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar initials="JD" name="Jane Doe" size="sm" />
        <Avatar initials="JD" name="Jane Doe" size="md" />
        <Avatar initials="JD" name="Jane Doe" size="lg" />
      </div>
      <div className="flex items-center gap-4">
        <Avatar initials="JD" name="Jane Doe" size="sm" src="https://placehold.co/64x64/3b9e8f/ffffff?text=JD" />
        <Avatar initials="JD" name="Jane Doe" size="md" src="https://placehold.co/96x96/3b9e8f/ffffff?text=JD" />
        <Avatar initials="JD" name="Jane Doe" size="lg" src="https://placehold.co/128x128/3b9e8f/ffffff?text=JD" />
      </div>
    </div>
  ),
};
