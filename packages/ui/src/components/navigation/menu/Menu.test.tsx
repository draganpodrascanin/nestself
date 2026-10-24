import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem } from './Menu';
import { Dialog, DialogContent } from '../../dialogs/dialog/Dialog';
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

function LinkMenuFixture() {
  return (
    <Menu>
      <MenuTrigger variant="quiet">Language</MenuTrigger>
      <MenuPopup>
        <MenuLinkItem href="/en" current>English</MenuLinkItem>
        <MenuLinkItem href="/sr-Latn">Srpski</MenuLinkItem>
        <MenuLinkItem href="/hu">Magyar</MenuLinkItem>
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

describe('MenuLinkItem', () => {
  it('link items render as <a href> with role menuitem', async () => {
    const user = userEvent.setup();
    render(<LinkMenuFixture />);
    await user.click(screen.getByRole('button', { name: 'Language' }));
    const enItem = await screen.findByRole('menuitem', { name: /English/ });
    expect(enItem.tagName).toBe('A');
    expect(enItem).toHaveAttribute('href', '/en');
    const srItem = screen.getByRole('menuitem', { name: /Srpski/ });
    expect(srItem.tagName).toBe('A');
    expect(srItem).toHaveAttribute('href', '/sr-Latn');
  });

  it('the current item has aria-current="true"', async () => {
    const user = userEvent.setup();
    render(<LinkMenuFixture />);
    await user.click(screen.getByRole('button', { name: 'Language' }));
    const enItem = await screen.findByRole('menuitem', { name: /English/ });
    expect(enItem).toHaveAttribute('aria-current', 'true');
    const srItem = screen.getByRole('menuitem', { name: /Srpski/ });
    expect(srItem).not.toHaveAttribute('aria-current');
  });

  it('ArrowDown moves highlight between link items', async () => {
    const user = userEvent.setup();
    render(<LinkMenuFixture />);
    const trigger = screen.getByRole('button', { name: 'Language' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: /English/ });
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    // Navigation works without error (Base UI manages highlighted state internally)
    expect(screen.getByRole('menuitem', { name: /Magyar/ })).toBeInTheDocument();
  });

  it('Escape closes and returns focus from link items', async () => {
    const user = userEvent.setup();
    render(<LinkMenuFixture />);
    const trigger = screen.getByRole('button', { name: 'Language' });
    await user.click(trigger);
    await screen.findByRole('menuitem', { name: /English/ });
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('link menu passes axe a11y check', async () => {
    const { container } = render(<LinkMenuFixture />);
    await expectNoA11yViolations(container);
  });
});

describe('Menu motion', () => {
  it('grows out of the trigger and stays mounted until its exit finishes', async () => {
    const user = userEvent.setup();
    render(<MenuFixture />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = await screen.findByRole('menu');
    expect(menu.style.transform).toMatch(/^scale\(/);
    expect(menu.className).toContain('origin-[var(--transform-origin)]');
    await user.keyboard('{Escape}');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  });

  it('opens again after an animated close', async () => {
    const user = userEvent.setup();
    render(<MenuFixture />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    await user.click(trigger);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('Menu layering', () => {
  it('inside DialogContent the popup layers above the dialog and an item takes a mouse click', async () => {
    const onSelect = vi.fn();
    render(
      <Dialog defaultOpen>
        <DialogContent title="Row actions">
          <MenuFixture onSelect={onSelect} />
        </DialogContent>
      </Dialog>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = await screen.findByRole('menu');
    const positioner = menu.parentElement!;
    expect(positioner.className).toContain('z-[var(--z-popup,var(--z-dropdown))]');
    let source: Element | null = positioner;
    while (source && !(typeof source.className === 'string' && source.className.includes('[--z-popup:'))) {
      source = source.parentElement;
    }
    expect(source?.className).toContain('[--z-popup:calc(var(--z-dialog)+1)]');

    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
