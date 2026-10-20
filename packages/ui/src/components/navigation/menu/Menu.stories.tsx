import type { Meta, StoryObj } from '@storybook/react-vite';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from './Menu';

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
