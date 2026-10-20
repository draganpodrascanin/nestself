import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet, SheetTrigger, SheetContent } from './Sheet';
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
});
