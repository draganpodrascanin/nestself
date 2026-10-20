import type { Meta, StoryObj } from '@storybook/react-vite';
import { VisuallyHidden } from './VisuallyHidden';

const meta: Meta<typeof VisuallyHidden> = {
  title: 'Foundation/VisuallyHidden',
  component: VisuallyHidden,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div>
      <p className="type-body text-text">
        The text below is visually hidden but present in the DOM for assistive
        technology. Inspect the DOM to see it.
      </p>
      <VisuallyHidden>
        This text is only visible to screen readers
      </VisuallyHidden>
    </div>
  ),
};

export const AsDiv: StoryObj = {
  render: () => (
    <div>
      <p className="type-body text-text">
        Rendered as a &lt;div&gt; element instead of the default &lt;span&gt;.
      </p>
      <VisuallyHidden as="div">
        Hidden block-level content for assistive technology
      </VisuallyHidden>
    </div>
  ),
};

export const WithinButton: StoryObj = {
  name: 'Inside a button',
  render: () => (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded-control border border-border-control bg-surface px-4 py-2 text-text"
    >
      <span aria-hidden>X</span>
      <VisuallyHidden>Close dialog</VisuallyHidden>
    </button>
  ),
};
