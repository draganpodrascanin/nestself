import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet, SheetTrigger, SheetContent } from './Sheet';
import { Field, Select } from '../../fields/field/Field';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Sheet', () => {
  it('opens with aria-modal', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Open sheet</SheetTrigger>
        <SheetContent title="Sheet Title">Sheet body</SheetContent>
      </Sheet>,
    );
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('Escape closes and returns focus to trigger', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent title="Escape Sheet">Content</SheetContent>
      </Sheet>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it('passes axe a11y check when open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent title="A11y Sheet">Content</SheetContent>
      </Sheet>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    await expectNoA11yViolations(container);
  });

  it('renders exactly one button when child is a Button element', () => {
    const { container } = render(
      <Sheet>
        <SheetTrigger>
          <button data-testid="my-btn">Open sheet btn</button>
        </SheetTrigger>
        <SheetContent title="Test Sheet">Body</SheetContent>
      </Sheet>,
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('data-testid', 'my-btn');
  });

  it('clicking a Button-element trigger opens the sheet', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>
          <button>Open via child</button>
        </SheetTrigger>
        <SheetContent title="Opened Sheet">Body</SheetContent>
      </Sheet>,
    );
    await user.click(screen.getByRole('button', { name: 'Open via child' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('Sheet motion', () => {
  it.each(['bottom', 'left', 'right'] as const)('slides in from the %s edge', async (side) => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Drawer" side={side}>
          Body
        </SheetContent>
      </Sheet>,
    );
    const popup = await screen.findByRole('dialog');
    expect(popup).toHaveAttribute('data-side', side);
    expect(popup.style.transform).toMatch(/^translate3d\(/);
  });

  it('keeps the drawer mounted while it slides out, then unmounts it', async () => {
    const user = userEvent.setup();
    render(
      <Sheet defaultOpen>
        <SheetContent title="Drawer" side="right">
          Body
        </SheetContent>
      </Sheet>,
    );
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });
});

describe('Sheet popup layering', () => {
  it('a Select opened inside SheetContent reads the above-dialog popup layer', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent title="Filters">
          <Field label="Choice">
            <Select options={[{ value: 'a', label: 'Option A' }]} placeholder="Pick one" />
          </Field>
        </SheetContent>
      </Sheet>,
    );
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Choice' }));
    let node: Element | null = (await screen.findByRole('listbox')).parentElement;
    expect(node?.className).toContain('z-[var(--z-popup,var(--z-dropdown))]');
    while (node && !(typeof node.className === 'string' && node.className.includes('[--z-popup:'))) {
      node = node.parentElement;
    }
    expect(node?.className).toContain('[--z-popup:calc(var(--z-dialog)+1)]');
  });
});
