import type { Meta, StoryObj } from '@storybook/react-vite';
import { OtpInput } from './OtpInput';

const meta: Meta<typeof OtpInput> = {
  title: 'Fields/OtpInput',
  component: OtpInput,
};
export default meta;

export const Default: StoryObj<typeof OtpInput> = {
  render: () => (
    <OtpInput placeholder="------" aria-label="Verification code" />
  ),
};

export const FourDigit: StoryObj<typeof OtpInput> = {
  render: () => <OtpInput length={4} placeholder="----" aria-label="PIN" />,
};
