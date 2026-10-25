import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShowMore } from './ShowMore';

const meta: Meta<typeof ShowMore> = {
  title: 'Navigation/ShowMore',
  component: ShowMore,
};
export default meta;

export const Default: StoryObj<typeof ShowMore> = {
  args: {
    label: 'Show more',
    onLoadMore: () => {},
    hasMore: true,
  },
};

export const Loading: StoryObj<typeof ShowMore> = {
  args: {
    label: 'Show more',
    onLoadMore: () => {},
    hasMore: true,
    loading: true,
    loadingLabel: 'Loading',
  },
};

export const WithAnnouncement: StoryObj<typeof ShowMore> = {
  args: {
    label: 'Show more',
    onLoadMore: () => {},
    hasMore: true,
    addedAnnouncement: '5 more items loaded',
  },
};
