import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent } from './AlertDialog';

const meta: Meta = {
  title: 'Dialogs/AlertDialog',
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="flex gap-4">
      <AlertDialog>
        <AlertDialogTrigger>
          <button className="rounded-control border border-border-control px-4 py-2">Cancel appointment</button>
        </AlertDialogTrigger>
        <AlertDialogContent
          title="Cancel this appointment?"
          description="This action cannot be undone. The appointment slot will be released."
          confirmLabel="Yes, cancel"
          cancelLabel="Keep it"
          destructive
        />
      </AlertDialog>
      <AlertDialog>
        <AlertDialogTrigger>
          <button className="rounded-control border border-border-control px-4 py-2">Confirm action</button>
        </AlertDialogTrigger>
        <AlertDialogContent
          title="Are you sure?"
          description="Please confirm you want to proceed."
          confirmLabel="Proceed"
          cancelLabel="Go back"
        />
      </AlertDialog>
    </div>
  ),
};
