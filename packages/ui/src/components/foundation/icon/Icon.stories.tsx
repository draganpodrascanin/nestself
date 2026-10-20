import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon, CategoryIcon, NavIcon } from './Icon';
import { Heart, Scales, House } from '@phosphor-icons/react';

const meta: Meta<typeof Icon> = {
  title: 'Foundation/Icon',
  component: Icon,
};
export default meta;

export const Default: StoryObj<typeof Icon> = {
  args: { icon: Heart, size: 24, weight: 'regular' },
};

export const WithLabel: StoryObj<typeof Icon> = {
  args: { icon: Heart, size: 24, label: 'Favourite', weight: 'fill' },
};

export const Weights: StoryObj = {
  render: () => (
    <div className="flex gap-4 items-center">
      <Icon icon={Heart} weight="regular" size={32} />
      <Icon icon={Heart} weight="fill" size={32} />
      <Icon icon={Heart} weight="duotone" size={32} />
      <Icon icon={Heart} weight="bold" size={32} />
    </div>
  ),
};

export const Categories: StoryObj = {
  render: () => (
    <div className="flex gap-4 items-center">
      <CategoryIcon category="mentalSupport" size={48} />
      <CategoryIcon category="legal" size={48} />
      <CategoryIcon category="financial" size={48} />
      <CategoryIcon category="teamEvents" size={48} />
      <CategoryIcon category="conversation" size={48} />
      <CategoryIcon category="appointment" size={48} />
      <CategoryIcon category="privacy" size={48} />
      <CategoryIcon category="content" size={48} />
    </div>
  ),
};

export const Nav: StoryObj = {
  render: () => (
    <div className="flex gap-4 items-center">
      <NavIcon icon={House} active label="Home" />
      <NavIcon icon={Scales} label="Legal" />
    </div>
  ),
};
