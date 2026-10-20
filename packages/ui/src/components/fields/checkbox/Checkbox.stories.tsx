import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox, CheckboxGroup } from './Checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Fields/Checkbox',
  component: Checkbox,
};
export default meta;

export const Default: StoryObj<typeof Checkbox> = {
  args: { children: 'Accept terms' },
};

export const Checked: StoryObj<typeof Checkbox> = {
  args: { children: 'Subscribed', defaultChecked: true },
};

export const Disabled: StoryObj<typeof Checkbox> = {
  args: { children: 'Locked', disabled: true },
};

export const Group: StoryObj = {
  render: () => (
    <CheckboxGroup legend="Notification preferences">
      <Checkbox>Email</Checkbox>
      <Checkbox>SMS</Checkbox>
      <Checkbox>Push notifications</Checkbox>
    </CheckboxGroup>
  ),
};
