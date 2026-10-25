import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowMore } from './ShowMore';
import { expectNoA11yViolations } from '../../../test/axe';

describe('ShowMore', () => {
  it('renders the button when hasMore is true', () => {
    render(<ShowMore label="Show more" onLoadMore={() => {}} hasMore />);
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('renders nothing when hasMore is false', () => {
    const { container } = render(
      <ShowMore label="Show more" onLoadMore={() => {}} hasMore={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('calls onLoadMore when clicked', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(<ShowMore label="Show more" onLoadMore={onLoadMore} hasMore />);
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('is keyboard accessible', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(<ShowMore label="Show more" onLoadMore={onLoadMore} hasMore />);
    const btn = screen.getByRole('button', { name: 'Show more' });
    btn.focus();
    await user.keyboard('{Enter}');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows loading state', () => {
    render(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        loading
        loadingLabel="Loading"
      />,
    );
    // Button's accessible name includes the sr-only loading status span,
    // so use a regex to match the label portion.
    const btn = screen.getByRole('button', { name: /Show more/i });
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('announces added items via live region', () => {
    render(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        addedAnnouncement="5 more items loaded"
      />,
    );
    expect(screen.getByText('5 more items loaded')).toBeInTheDocument();
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent('5 more items loaded');
  });

  it('has no a11y violations', async () => {
    const { container } = render(
      <ShowMore label="Show more" onLoadMore={() => {}} hasMore />,
    );
    await expectNoA11yViolations(container);
  });
});
