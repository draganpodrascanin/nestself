import type { Meta, StoryObj } from '@storybook/react-vite';
import { FormErrorSummary } from './FormErrorSummary';

const meta: Meta<typeof FormErrorSummary> = {
  title: 'Fields/FormErrorSummary',
  component: FormErrorSummary,
};
export default meta;

export const Default: StoryObj<typeof FormErrorSummary> = {
  args: {
    title: 'Please fix the following errors',
    errors: [
      { id: 'name', label: 'Name', message: 'Name is required' },
      { id: 'email', label: 'Email', message: 'Must be a valid email address' },
    ],
  },
};

export const Empty: StoryObj<typeof FormErrorSummary> = {
  args: {
    title: 'Errors',
    errors: [],
  },
};
