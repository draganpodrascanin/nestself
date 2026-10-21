import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './Card';

const meta: Meta<typeof Card> = {
  title: 'Patterns/Card',
  component: Card,
};
export default meta;

export const AllTones: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-sm">
      <Card tone="surface" padding="md">
        <h3 className="type-label mb-1">Surface tone</h3>
        <p className="type-body text-text-secondary">
          The default card background.
        </p>
      </Card>
      <Card tone="subtle" padding="md">
        <h3 className="type-label mb-1">Subtle tone</h3>
        <p className="type-body text-text-secondary">
          Blends with the canvas background.
        </p>
      </Card>
      <Card tone="brand" padding="md">
        <h3 className="type-label mb-1">Brand tone</h3>
        <p className="type-body text-text-secondary">
          Uses the accent-soft background.
        </p>
      </Card>
    </div>
  ),
};

export const Padding: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-sm">
      <Card padding="none">
        <div className="p-4">Padding: none (content manages its own spacing)</div>
      </Card>
      <Card padding="sm">Padding: sm</Card>
      <Card padding="md">Padding: md</Card>
      <Card padding="lg">Padding: lg</Card>
    </div>
  ),
};

export const Interactive: StoryObj = {
  render: () => (
    <Card interactive padding="md" tone="surface">
      <a href="/example" className="type-label text-text no-underline">
        Interactive card with a link
      </a>
      <p className="type-body text-text-secondary mt-1">
        Hover to see the border and shadow effect.
      </p>
    </Card>
  ),
};

export const AsArticle: StoryObj = {
  render: () => (
    <Card as="article" padding="lg" tone="surface">
      <h2 className="type-section-title mb-2">Article card</h2>
      <p className="type-body text-text-secondary">
        Rendered as an &lt;article&gt; element.
      </p>
    </Card>
  ),
};
