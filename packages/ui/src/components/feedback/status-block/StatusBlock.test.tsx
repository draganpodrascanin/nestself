import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBlock } from './StatusBlock';
import { expectNoA11yViolations } from '../../../test/axe';

describe('StatusBlock', () => {
  it('renders title and body for protected state', () => {
    const action = { label: 'Request access', onClick: vi.fn() };
    render(
      <StatusBlock state="protected" title="Protected content" body="You do not have access." action={action} />,
    );
    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.getByText('You do not have access.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request access' })).toBeInTheDocument();
  });

  it('calls action handler when clicked', async () => {
    const onClick = vi.fn();
    render(
      <StatusBlock state="protected" title="Protected" body="No access." action={{ label: 'Unlock', onClick }} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders aria-busy for loading state', () => {
    const { container } = render(
      <StatusBlock state="loading" title="Loading data" body="Please wait" />,
    );
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
  });

  it('renders Skeleton in loading state', () => {
    render(<StatusBlock state="loading" title="Loading" body="Wait" />);
    // Skeleton has aria-hidden bars
    expect(document.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('renders secondary button for offline state', () => {
    render(
      <StatusBlock
        state="offline"
        title="Offline"
        body="Check connection."
        action={{ label: 'Retry', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <StatusBlock state="empty" title="No appointments" body="You have no upcoming appointments." />,
    );
    await expectNoA11yViolations(container);
  });
});
