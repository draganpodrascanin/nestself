import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Chip, ChipGroup } from './Chip';

const meta: Meta = {
  title: 'Fields/Chip',
};
export default meta;

function ChipDemo() {
  const [pressed, setPressed] = useState(false);
  return <Chip pressed={pressed} onPressedChange={setPressed}>Mental Support</Chip>;
}

export const Default: StoryObj = {
  render: () => <ChipDemo />,
};

function ChipGroupDemo() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (val: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };
  return (
    <ChipGroup label="Categories">
      {['Legal', 'Financial', 'Mental Support'].map((cat) => (
        <Chip key={cat} pressed={selected.has(cat)} onPressedChange={() => toggle(cat)}>
          {cat}
        </Chip>
      ))}
    </ChipGroup>
  );
}

export const Group: StoryObj = {
  render: () => <ChipGroupDemo />,
};
