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

/** Open by default so the bottom sheet, scrim and safe-area padding are visible in the catalogue. */
export const Open: StoryObj = {
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger>
        <button className="rounded-control border border-border-control px-4 py-2">Open sheet</button>
      </SheetTrigger>
      <SheetContent title="Who can see this?" description="Your own conversations and appointments are yours. Your employer sees eligibility administration, programme budget and protected aggregate reporting, never individual support content.">
        <p>Sheet body content goes here.</p>
      </SheetContent>
    </Sheet>
  ),
};
