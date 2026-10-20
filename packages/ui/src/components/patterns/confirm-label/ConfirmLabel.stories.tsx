import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfirmLabel } from './ConfirmLabel';

const meta: Meta<typeof ConfirmLabel> = {
  title: 'Patterns/ConfirmLabel',
  component: ConfirmLabel,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <button className="inline-flex items-center justify-center gap-2 rounded-control border border-transparent bg-primary text-on-primary px-5 py-2.5 min-h-11 font-[var(--font-weight-label)]">
      <ConfirmLabel action="Confirm and pay" amount={'€10.00'} />
    </button>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <button className="inline-flex items-center justify-center rounded-control border border-transparent bg-primary text-on-primary px-5 py-2.5 min-h-11 font-[var(--font-weight-label)]">
        <ConfirmLabel action="Confirm and pay" amount={'€10.00'} />
      </button>
      <button className="inline-flex items-center justify-center rounded-control border border-transparent bg-primary text-on-primary px-5 py-2.5 min-h-11 font-[var(--font-weight-label)]">
        <ConfirmLabel action="Book now for" amount={'¥500'} />
      </button>
      <button disabled className="inline-flex items-center justify-center rounded-control border border-transparent bg-disabled-surface text-disabled-text px-5 py-2.5 min-h-11 font-[var(--font-weight-label)]">
        <ConfirmLabel action="Confirm and pay" amount={'€0.00'} />
      </button>
    </div>
  ),
};
