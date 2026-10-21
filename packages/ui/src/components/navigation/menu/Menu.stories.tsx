import type { Meta, StoryObj } from '@storybook/react-vite';
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem } from './Menu';

const meta: Meta = {
  title: 'Navigation/Menu',
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <Menu>
      <MenuTrigger>Options</MenuTrigger>
      <MenuPopup>
        <MenuItem>Edit profile</MenuItem>
        <MenuItem>Preferences</MenuItem>
        <MenuItem>Sign out</MenuItem>
      </MenuPopup>
    </Menu>
  ),
};

export const LinkItems: StoryObj = {
  render: () => (
    <Menu>
      <MenuTrigger variant="quiet">Language</MenuTrigger>
      <MenuPopup>
        <MenuLinkItem href="/en" current>English</MenuLinkItem>
        <MenuLinkItem href="/sr-Latn">Srpski</MenuLinkItem>
        <MenuLinkItem href="/hu">Magyar</MenuLinkItem>
      </MenuPopup>
    </Menu>
  ),
};
