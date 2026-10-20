import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert } from './Alert';

const meta: Meta<typeof Alert> = {
  title: 'Feedback/Alert',
  component: Alert,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Alert tone="info" title="Information">This is an informational alert.</Alert>
      <Alert tone="success" title="Success">Operation completed successfully.</Alert>
      <Alert tone="warning" title="Warning">Please review before continuing.</Alert>
      <Alert tone="danger" title="Error">Something went wrong.</Alert>
      <Alert tone="info">Alert without a title.</Alert>
    </div>
  ),
};
