import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '@nestself/ui';
import { CtaDialog, ResourcePicker } from './BlockDialogs.tsx';
import { DEFAULT_NODE_VIEW_LABELS } from './node-view-labels.ts';
import type { ResourceSearchResult } from './node-view-labels.ts';

/** Story fixtures: fictional titles, nothing is created. */
const RESULTS: ResourceSearchResult[] = [
  { id: 'story_1', title: 'A calmer end to the day', type: 'article' },
  { id: 'story_2', title: 'Preparing for a team meeting', type: 'article' },
];

const search = async (q: string) =>
  RESULTS.filter((r) => r.title.toLowerCase().includes(q.toLowerCase()));

const meta = {
  title: 'Content/BlockDialogs',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The resource picker used by the call to action and related resource dialogs. */
function PickerDemo() {
  const [selected, setSelected] = useState<ResourceSearchResult | null>(null);
  return (
    <div className="max-w-md">
      <ResourcePicker
        label="Content"
        labels={DEFAULT_NODE_VIEW_LABELS}
        search={search}
        selected={selected}
        onSelect={setSelected}
      />
    </div>
  );
}

export const ResourcePickerStates: Story = { render: () => <PickerDemo /> };

/** The call to action dialog. */
function CtaDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open call to action</Button>
      <CtaDialog
        open={open}
        initial={undefined}
        initialTitle={null}
        labels={DEFAULT_NODE_VIEW_LABELS}
        search={search}
        onConfirm={() => setOpen(false)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export const CallToAction: Story = { render: () => <CtaDemo /> };
