import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './ToastProvider';
import { useToast } from './useToast';
import { expectNoA11yViolations } from '../../../test/axe';

function ToastTrigger({ title, description, tone }: { title: string; description?: string; tone?: 'info' | 'success' | 'warning' | 'danger' }) {
  const toast = useToast();
  return (
    <button onClick={() => toast.add({ title, description, tone })}>
      Show toast
    </button>
  );
}

const toastLabels = { dismiss: 'Dismiss' };

describe('Toast', () => {
  it('shows a toast when triggered', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={toastLabels}>
        <ToastTrigger title="Saved" description="Changes saved." />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Show toast' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Changes saved.')).toBeInTheDocument();
  });

  it('can be dismissed via Escape key', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={toastLabels}>
        <ToastTrigger title="Dismissable toast" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Show toast' }));
    expect(await screen.findByText('Dismissable toast')).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <ToastProvider labels={toastLabels}>
        <ToastTrigger title="Accessible toast" />
      </ToastProvider>,
    );
    await expectNoA11yViolations(container);
  });
});
