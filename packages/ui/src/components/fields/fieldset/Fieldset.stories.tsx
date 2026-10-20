import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fieldset } from './Fieldset';
import { Field, Input } from '../field';

const meta: Meta<typeof Fieldset> = {
  title: 'Fields/Fieldset',
  component: Fieldset,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <Fieldset legend="Personal information" description="All fields are required">
      <Field label="First name" required>
        <Input />
      </Field>
      <Field label="Last name" required>
        <Input />
      </Field>
    </Fieldset>
  ),
};
