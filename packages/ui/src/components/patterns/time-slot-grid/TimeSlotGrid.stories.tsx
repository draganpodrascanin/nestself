import type { Meta, StoryObj } from '@storybook/react-vite';
import { TimeSlotGrid } from './TimeSlotGrid';

const slots = [
  { id: '1', label: '9:00 AM', available: true },
  { id: '2', label: '10:00 AM', available: true },
  { id: '3', label: '11:00 AM', available: false },
  { id: '4', label: '2:00 PM', available: true },
  { id: '5', label: '3:00 PM', available: true },
  { id: '6', label: '4:00 PM', available: true },
];

const meta: Meta<typeof TimeSlotGrid> = {
  title: 'Patterns/TimeSlotGrid',
  component: TimeSlotGrid,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-xs">
      <TimeSlotGrid
        slots={slots}
        selectedId={null}
        onSelect={() => {}}
        timeZoneLabel="Times in CET"
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-xs">
      <div>
        <p className="type-label mb-2">No selection</p>
        <TimeSlotGrid
          slots={slots}
          selectedId={null}
          onSelect={() => {}}
          timeZoneLabel="Times in CET"
        />
      </div>
      <div>
        <p className="type-label mb-2">With selection</p>
        <TimeSlotGrid
          slots={slots}
          selectedId="2"
          onSelect={() => {}}
          timeZoneLabel="Times in CET"
        />
      </div>
    </div>
  ),
};
