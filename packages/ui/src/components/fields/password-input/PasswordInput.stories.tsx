import type { Meta, StoryObj } from '@storybook/react-vite';
import { PasswordInput } from './PasswordInput';

const meta: Meta<typeof PasswordInput> = {
  title: 'Fields/PasswordInput',
  component: PasswordInput,
};
export default meta;

export const Default: StoryObj<typeof PasswordInput> = {
  render: () => (
    <PasswordInput placeholder="Enter password" aria-label="Password" />
  ),
};

export const WithValue: StoryObj<typeof PasswordInput> = {
  render: () => (
    <PasswordInput defaultValue="secret123" aria-label="Password" />
  ),
};
