import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sheet, SheetTrigger, SheetContent } from './Sheet';

const meta: Meta = {
  title: 'Dialogs/Sheet',
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <Sheet>
      <SheetTrigger>
        <button className="rounded-control border border-border-control px-4 py-2">Open Sheet</button>
      </SheetTrigger>
      <SheetContent title="Select a time" description="Choose an available slot.">
        <div className="grid grid-cols-2 gap-3 mt-4">
          <button className="rounded-control border border-border-control px-4 py-3">9:00 AM</button>
          <button className="rounded-control border border-border-control px-4 py-3">10:00 AM</button>
          <button className="rounded-control border border-border-control px-4 py-3">11:00 AM</button>
          <button className="rounded-control border border-border-control px-4 py-3">2:00 PM</button>
        </div>
      </SheetContent>
    </Sheet>
  ),
};
