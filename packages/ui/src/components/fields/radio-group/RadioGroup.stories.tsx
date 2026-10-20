import type { Meta, StoryObj } from '@storybook/react-vite';
import { RadioGroup, RadioItem } from './RadioGroup';

const meta: Meta = {
  title: 'Fields/RadioGroup',
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <RadioGroup label="Preferred contact" defaultValue="email">
      <RadioItem value="email">Email</RadioItem>
      <RadioItem value="phone">Phone</RadioItem>
      <RadioItem value="sms">SMS</RadioItem>
    </RadioGroup>
  ),
};

export const Disabled: StoryObj = {
  render: () => (
    <RadioGroup label="Plan" defaultValue="free" disabled>
      <RadioItem value="free">Free</RadioItem>
      <RadioItem value="pro">Pro</RadioItem>
    </RadioGroup>
  ),
};
