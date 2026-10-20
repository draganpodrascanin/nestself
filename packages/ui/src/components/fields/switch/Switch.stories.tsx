import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch } from './Switch';

const meta: Meta<typeof Switch> = {
  title: 'Fields/Switch',
  component: Switch,
};
export default meta;

export const Default: StoryObj<typeof Switch> = {
  args: { children: 'Dark mode' },
};

export const Checked: StoryObj<typeof Switch> = {
  args: { children: 'Notifications', defaultChecked: true },
};

export const Disabled: StoryObj<typeof Switch> = {
  args: { children: 'Locked', disabled: true },
};
