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

/** Open by default so the confirmation layout is visible in the catalogue. */
export const Open: StoryObj = {
  render: () => (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger>
        <button className="rounded-control border border-border-control px-4 py-2">Cancel appointment</button>
      </AlertDialogTrigger>
      <AlertDialogContent
        title="Cancel this appointment?"
        description="Cancelling frees this time. Review the cancellation terms that apply to your coverage before continuing."
        confirmLabel="Cancel example"
        cancelLabel="Keep appointment"
        destructive
      />
    </AlertDialog>
  ),
};

/** The confirmed action is running: the confirm button is disabled and busy. */
export const ConfirmPending: StoryObj = {
  render: () => (
    <AlertDialog defaultOpen>
      <AlertDialogContent
        title="Revoke this grant?"
        description="The person loses these permissions straight away."
        confirmLabel="Revoke grant"
        cancelLabel="Keep grant"
        destructive
        confirmPending
      />
    </AlertDialog>
  ),
};
