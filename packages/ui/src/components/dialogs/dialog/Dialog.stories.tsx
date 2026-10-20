import type { Meta, StoryObj } from '@storybook/react-vite';
import { Dialog, DialogTrigger, DialogContent, DialogActions } from './Dialog';

const meta: Meta = {
  title: 'Dialogs/Dialog',
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <Dialog>
      <DialogTrigger>
        <button className="rounded-control border border-border-control px-4 py-2">Open Dialog</button>
      </DialogTrigger>
      <DialogContent title="Dialog Title" description="This is a description of the dialog.">
        <p>Dialog body content goes here.</p>
        <DialogActions>
          <button className="rounded-control border border-border-control px-4 py-2">Cancel</button>
          <button className="rounded-control border border-transparent bg-primary text-on-primary px-4 py-2">Confirm</button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  ),
};

/** Open by default so the modal, scrim, close control and actions row are visible in the catalogue. */
export const Open: StoryObj = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger>
        <button className="rounded-control border border-border-control px-4 py-2">Open Dialog</button>
      </DialogTrigger>
      <DialogContent title="Cancel this appointment?" description="Cancelling frees this time. Review the cancellation terms that apply to your coverage before continuing.">
        <DialogActions>
          <button className="rounded-control border border-border-control px-4 py-2">Keep appointment</button>
          <button className="rounded-control border border-transparent bg-primary text-on-primary px-4 py-2">Cancel example</button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  ),
};
