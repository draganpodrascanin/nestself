import type { Meta, StoryObj } from '@storybook/react-vite';
import { withCallsI18n } from '../stories/decorators';
import { CrisisBlock, CrisisResourcesButton } from './CrisisBlock';

const meta: Meta<typeof CrisisBlock> = {
  title: 'Video/CrisisBlock',
  component: CrisisBlock,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof CrisisBlock>;

export const Employee: Story = { args: { audience: 'employee' } };

/** The expert also sees emergency guidance (UX-17). */
export const Expert: Story = { args: { audience: 'expert' } };

/** The in-call control: opens the block in an animated bottom sheet (motion suite entry). */
export const InCallSheet: Story = { render: () => <CrisisResourcesButton audience="employee" /> };

export const InCallSheetExpert: Story = { render: () => <CrisisResourcesButton audience="expert" side="right" /> };

export const Serbian: Story = { args: { audience: 'expert' }, parameters: { locale: 'sr-Latn' } };

export const SerbianCyrillic: Story = { args: { audience: 'employee' }, parameters: { locale: 'sr-Cyrl' } };

export const Hungarian: Story = { args: { audience: 'employee' }, parameters: { locale: 'hu' } };
