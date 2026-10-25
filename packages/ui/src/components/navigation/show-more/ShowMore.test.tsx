import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShowMore } from './ShowMore';
import { expectNoA11yViolations } from '../../../test/axe';

describe('ShowMore', () => {
  it('renders the button when hasMore is true', () => {
    render(<ShowMore label="Show more" onLoadMore={() => {}} hasMore />);
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('still renders the container when hasMore is false (no focus loss)', () => {
    const { container } = render(
      <ShowMore label="Show more" onLoadMore={() => {}} hasMore={false} />,
    );
    // Container is in the DOM, but button is not
    expect(container.innerHTML).not.toBe('');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Live region remains mounted
    expect(screen.getByRole('status')).toBeInTheDocument();
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
    const btn = screen.getByRole('button', { name: /Show more/i });
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('live region is always in the DOM (even without announcement)', () => {
    render(<ShowMore label="Show more" onLoadMore={() => {}} hasMore />);
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent('');
  });

  it('defers the announcement so screen readers detect the change', async () => {
    render(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        addedAnnouncement="5 more items loaded"
      />,
    );
    const liveRegion = screen.getByRole('status');
    // Initially empty (deferred)
    // After the timeout it fills
    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('5 more items loaded');
    });
  });

  it('moves focus to focusTargetRef when load completes', async () => {
    const ref = createRef<HTMLDivElement>();
    const { rerender } = render(
      <div>
        <div ref={ref} tabIndex={-1} data-testid="target">Card</div>
        <ShowMore
          label="Show more"
          onLoadMore={() => {}}
          hasMore
          loading
          focusTargetRef={ref}
        />
      </div>,
    );

    // Simulate load completing: loading goes from true to false, announcement set
    rerender(
      <div>
        <div ref={ref} tabIndex={-1} data-testid="target">Card</div>
        <ShowMore
          label="Show more"
          onLoadMore={() => {}}
          hasMore
          loading={false}
          addedAnnouncement="3 items loaded"
          focusTargetRef={ref}
        />
      </div>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('target'));
    });
  });

  it('has no a11y violations', async () => {
    const { container } = render(
      <ShowMore label="Show more" onLoadMore={() => {}} hasMore />,
    );
    await expectNoA11yViolations(container);
  });
});
