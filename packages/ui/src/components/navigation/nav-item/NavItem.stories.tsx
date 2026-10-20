import type { Meta, StoryObj } from '@storybook/react-vite';
import { House, ChatCircleText, CalendarCheck, Gear } from '@phosphor-icons/react';
import { NavItem } from './NavItem';

const meta: Meta<typeof NavItem> = {
  title: 'Navigation/NavItem',
  component: NavItem,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <nav className="flex gap-2">
      <NavItem href="/home" icon={House} label="Home" active />
      <NavItem href="/messages" icon={ChatCircleText} label="Messages" />
      <NavItem href="/appointments" icon={CalendarCheck} label="Appointments" />
      <NavItem href="/settings" icon={Gear} label="Settings" />
    </nav>
  ),
};
