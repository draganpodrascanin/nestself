import type { Meta, StoryObj } from '@storybook/react-vite';
import { SiteHeader } from './SiteHeader';

const meta: Meta<typeof SiteHeader> = {
  title: 'Navigation/SiteHeader',
  component: SiteHeader,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <SiteHeader
      brand={{ label: 'NestSelf', href: '/' }}
      links={[
        { label: 'Home', href: '/', current: true },
        { label: 'Features', href: '/features' },
        { label: 'Pricing', href: '/pricing' },
        { label: 'About', href: '/about' },
      ]}
      menuLabel="Open menu"
      closeLabel="Close menu"
    />
  ),
};

export const WithUtilities: StoryObj = {
  render: () => (
    <SiteHeader
      brand={{ label: 'NestSelf', href: '/' }}
      links={[
        { label: 'Home', href: '/', current: true },
        { label: 'Features', href: '/features' },
        { label: 'Pricing', href: '/pricing' },
        { label: 'About', href: '/about' },
      ]}
      utilities={<button type="button">EN</button>}
      menuLabel="Open menu"
      closeLabel="Close menu"
    />
  ),
};
