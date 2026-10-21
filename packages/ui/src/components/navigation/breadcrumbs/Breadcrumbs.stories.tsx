import type { Meta, StoryObj } from '@storybook/react-vite';
import { Breadcrumbs } from './Breadcrumbs';

const meta: Meta<typeof Breadcrumbs> = {
  title: 'Navigation/Breadcrumbs',
  component: Breadcrumbs,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <Breadcrumbs
      label="Breadcrumb"
      items={[
        { label: 'Home', href: '/' },
        { label: 'Resources', href: '/resources' },
        { label: 'Stress Management' },
      ]}
    />
  ),
};

export const TwoLevels: StoryObj = {
  render: () => (
    <Breadcrumbs
      label="Breadcrumb"
      items={[
        { label: 'Home', href: '/' },
        { label: 'Articles' },
      ]}
    />
  ),
};
