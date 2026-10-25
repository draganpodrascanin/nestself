import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContentCard } from './ContentCard';

const meta: Meta<typeof ContentCard> = {
  title: 'Patterns/ContentCard',
  component: ContentCard,
};
export default meta;

export const Default: StoryObj<typeof ContentCard> = {
  args: {
    resourceId: 'res_1',
    title: 'Recognizing Burnout Early',
    outcome: 'You will learn the early warning signs and practical steps.',
    formatLabel: 'Article',
    saved: false,
    saveLabel: 'Save',
    unsaveLabel: 'Unsave',
    onToggleSave: () => {},
    href: '#',
  },
};

export const WithImage: StoryObj<typeof ContentCard> = {
  args: {
    ...Default.args,
    imageUrl: 'https://picsum.photos/400/250',
    focalPoint: { x: 0.5, y: 0.3 },
    imageAlt: 'Sample cover',
  },
};

export const Saved: StoryObj<typeof ContentCard> = {
  args: {
    ...Default.args,
    saved: true,
  },
};

export const Placeholder: StoryObj<typeof ContentCard> = {
  args: {
    ...Default.args,
    placeholder: true,
  },
};

export const Grid: StoryObj = {
  render: () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl">
      <ContentCard
        resourceId="res_1"
        title="Recognizing Burnout Early"
        outcome="You will learn the early warning signs."
        formatLabel="Article"
        saved={false}
        saveLabel="Save"
        unsaveLabel="Unsave"
        onToggleSave={() => {}}
        href="#"
      />
      <ContentCard
        resourceId="res_2"
        title="Understanding Your Employment Rights"
        outcome="Covers the key rights every employee should understand."
        formatLabel="Article"
        saved
        saveLabel="Save"
        unsaveLabel="Unsave"
        onToggleSave={() => {}}
        href="#"
      />
      <ContentCard
        resourceId="res_3"
        title="Building a Practical Savings Plan"
        outcome="A structured approach to building stability."
        formatLabel="Article"
        saved={false}
        saveLabel="Save"
        unsaveLabel="Unsave"
        onToggleSave={() => {}}
        href="#"
      />
    </div>
  ),
};
