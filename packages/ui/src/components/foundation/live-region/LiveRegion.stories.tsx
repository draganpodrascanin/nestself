import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { LiveRegion, AnnouncerProvider, useAnnounce } from './LiveRegion';

const meta: Meta<typeof LiveRegion> = {
  title: 'Foundation/LiveRegion',
  component: LiveRegion,
};
export default meta;

export const Polite: StoryObj = {
  render: () => (
    <LiveRegion politeness="polite">Item saved successfully.</LiveRegion>
  ),
};

export const Assertive: StoryObj = {
  render: () => (
    <LiveRegion politeness="assertive">Connection lost. Retrying...</LiveRegion>
  ),
};

function AnnounceDemo() {
  const { announce } = useAnnounce();
  const [count, setCount] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-control border border-border-control bg-surface px-4 py-2 text-text"
        onClick={() => {
          const next = count + 1;
          setCount(next);
          announce(`Action performed ${String(next)} time${next === 1 ? '' : 's'}`);
        }}
      >
        Perform action
      </button>
      <p className="type-metadata text-text-secondary">
        Clicked {count} time{count === 1 ? '' : 's'}. The announcement is
        delivered to screen readers via a visually hidden live region.
      </p>
    </div>
  );
}

export const AnnouncerPattern: StoryObj = {
  name: 'AnnouncerProvider + useAnnounce',
  render: () => (
    <AnnouncerProvider>
      <AnnounceDemo />
    </AnnouncerProvider>
  ),
};
