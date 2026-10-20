import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field, Input, Textarea, Select } from './Field';

const meta: Meta = {
  title: 'Fields/Field',
};
export default meta;

export const InputDefault: StoryObj = {
  name: 'Input',
  render: () => (
    <Field label="Full name" description="As it appears on your ID">
      <Input placeholder="Enter your name" />
    </Field>
  ),
};

export const InputRequired: StoryObj = {
  render: () => (
    <Field label="Email" required>
      <Input type="email" required placeholder="email@example.com" />
    </Field>
  ),
};

export const InputError: StoryObj = {
  render: () => (
    <Field label="Email" error="This field is required">
      <Input type="email" />
    </Field>
  ),
};

export const InputDisabled: StoryObj = {
  render: () => (
    <Field label="Name">
      <Input disabled defaultValue="Locked value" />
    </Field>
  ),
};

export const TextareaDefault: StoryObj = {
  name: 'Textarea',
  render: () => (
    <Field label="Notes" description="Optional notes">
      <Textarea placeholder="Write here..." />
    </Field>
  ),
};

export const SelectDefault: StoryObj = {
  name: 'Select',
  render: () => (
    <Field label="Category">
      <Select
        options={[
          { value: 'legal', label: 'Legal' },
          { value: 'financial', label: 'Financial' },
          { value: 'mental', label: 'Mental Support' },
        ]}
        placeholder="Choose a category"
      />
    </Field>
  ),
};
