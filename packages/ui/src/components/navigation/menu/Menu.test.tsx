import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from './Menu';
import { expectNoA11yViolations } from '../../../test/axe';

function MenuFixture({ onSelect }: { onSelect?: () => void }) {
  return (
    <Menu>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPopup>
        <MenuItem onClick={onSelect}>Edit</MenuItem>
        <MenuItem>Delete</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

describe('Menu', () => {
  it('opens with Enter key and shows menu items', async () => {
    const user = userEvent.setup();
    render(<MenuFixture />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('closes with Escape and returns focus to trigger', async () => {
    const user = userEvent.setup();
    render(<MenuFixture />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<MenuFixture />);
    await expectNoA11yViolations(container);
  });
});
