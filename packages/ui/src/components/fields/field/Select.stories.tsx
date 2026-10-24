import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field, Select } from './Field';
import { Dialog, DialogContent, DialogActions } from '../../dialogs/dialog/Dialog';

const meta: Meta = {
  title: 'Fields/Select',
};
export default meta;

/**
 * A Select opened inside an open dialog: the popup layers above the dialog
 * (`--z-popup` set by `DialogContent`), so options take a mouse click.
 */
export const InsideDialog: StoryObj = {
  name: 'Inside Dialog',
  render: () => (
    <Dialog defaultOpen>
      <DialogContent title="Delegate access" description="Example only: nothing is created.">
        <Field label="Team member">
          <Select
            options={[
              { value: 'ana', label: 'Sample person A' },
              { value: 'stefan', label: 'Sample person B' },
              { value: 'jovan', label: 'Sample person C' },
            ]}
            placeholder="Choose a person"
          />
        </Field>
        <DialogActions>
          <button className="rounded-control border border-border-control px-4 py-2">Cancel</button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  ),
};
