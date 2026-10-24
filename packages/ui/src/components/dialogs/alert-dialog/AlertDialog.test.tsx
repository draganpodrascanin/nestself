import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent } from './AlertDialog';
import { expectNoA11yViolations } from '../../../test/axe';

describe('AlertDialog', () => {
  it('opens with aria-modal', async () => {
    const user = userEvent.setup();
    render(
      <AlertDialog>
        <AlertDialogTrigger>Cancel appointment</AlertDialogTrigger>
        <AlertDialogContent
          title="Cancel this appointment?"
          description="This action cannot be undone."
          confirmLabel="Yes, cancel"
          cancelLabel="Keep it"
          destructive
        />
      </AlertDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('confirm button calls handler once', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent
          title="Delete?"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          onConfirm={onConfirm}
        />
      </AlertDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancel button closes without calling confirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <AlertDialog>
        <AlertDialogTrigger>Remove</AlertDialogTrigger>
        <AlertDialogContent
          title="Remove?"
          confirmLabel="Yes"
          cancelLabel="No"
          onConfirm={onConfirm}
        />
      </AlertDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('passes axe a11y check when open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AlertDialog>
        <AlertDialogTrigger>Open</AlertDialogTrigger>
        <AlertDialogContent
          title="Confirm action"
          confirmLabel="OK"
          cancelLabel="Cancel"
        />
      </AlertDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('alertdialog');
    await expectNoA11yViolations(container);
  });

  it('renders exactly one button when child is a Button element', () => {
    const { container } = render(
      <AlertDialog>
        <AlertDialogTrigger>
          <button data-testid="my-btn">Remove item</button>
        </AlertDialogTrigger>
        <AlertDialogContent
          title="Remove?"
          confirmLabel="Yes"
          cancelLabel="No"
        />
      </AlertDialog>,
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('data-testid', 'my-btn');
  });

  it('clicking a Button-element trigger opens the alert dialog', async () => {
    const user = userEvent.setup();
    render(
      <AlertDialog>
        <AlertDialogTrigger>
          <button>Remove via child</button>
        </AlertDialogTrigger>
        <AlertDialogContent
          title="Remove?"
          confirmLabel="Yes"
          cancelLabel="No"
        />
      </AlertDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove via child' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('AlertDialog motion', () => {
  it('enters through the dialog preset and unmounts after the exit', async () => {
    const user = userEvent.setup();
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent title="Delete?" confirmLabel="Delete" cancelLabel="Keep" />
      </AlertDialog>,
    );
    const popup = await screen.findByRole('alertdialog');
    expect(popup.style.transform).toMatch(/^translate3d\(.+\) scale\(.+\)$/);
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
  });
});
