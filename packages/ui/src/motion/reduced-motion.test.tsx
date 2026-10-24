import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent } from '../components/dialogs/dialog';
import { Sheet, SheetContent } from '../components/dialogs/sheet';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../components/navigation/menu';

/*
 * Motion reads `prefers-reduced-motion` once, on first use, and this file
 * runs in its own module graph, so the preference is set before any render.
 */
beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

describe('reduced motion', () => {
  it('a dialog only fades: no translate or scale', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent title="Calm">Body</DialogContent>
      </Dialog>,
    );
    const popup = await screen.findByRole('dialog');
    expect(popup.style.transform).toBe('');
    expect(popup.style.opacity).not.toBe('');
  });

  it('a drawer appears in place instead of sliding', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Calm drawer" side="right">
          Body
        </SheetContent>
      </Sheet>,
    );
    const popup = await screen.findByRole('dialog');
    expect(popup.style.transform).toBe('');
  });

  it('a menu does not scale', async () => {
    const user = userEvent.setup();
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem>Edit</MenuItem>
        </MenuPopup>
      </Menu>,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = await screen.findByRole('menu');
    expect(menu.style.transform).toBe('');
  });
});
