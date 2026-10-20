import type { Meta, StoryObj } from '@storybook/react-vite';
import { ToastProvider } from './ToastProvider';
import { useToast } from './useToast';

function ToastDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <button
        className="rounded-control border border-border-control px-4 py-2"
        onClick={() => toast.add({ title: 'Saved', description: 'Your changes have been saved.' })}
      >
        Show Info Toast
      </button>
      <button
        className="rounded-control border border-border-control px-4 py-2"
        onClick={() => toast.add({ title: 'Success', tone: 'success' })}
      >
        Show Success Toast
      </button>
      <button
        className="rounded-control border border-border-control px-4 py-2"
        onClick={() => toast.add({ title: 'Warning', tone: 'warning', description: 'Check your input.' })}
      >
        Show Warning Toast
      </button>
    </div>
  );
}

const meta: Meta = {
  title: 'Feedback/Toast',
  decorators: [(Story) => <ToastProvider labels={{ dismiss: 'Dismiss' }}><Story /></ToastProvider>],
};
export default meta;

export const States: StoryObj = {
  render: () => <ToastDemo />,
};
