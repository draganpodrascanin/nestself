import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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

  // --- Spurious announcement prevention ---

  it('does NOT announce on first render even when addedAnnouncement is provided', async () => {
    render(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        addedAnnouncement="5 more items loaded"
      />,
    );
    const liveRegion = screen.getByRole('status');
    // Wait enough time for any deferred announcement to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(liveRegion).toHaveTextContent('');
  });

  it('does NOT announce on a refetch (loading cycle without user click)', async () => {
    const { rerender } = render(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        loading
      />,
    );

    // Simulate refetch completing: loading true -> false, with announcement text
    rerender(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        loading={false}
        addedAnnouncement="3 items loaded"
      />,
    );

    const liveRegion = screen.getByRole('status');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(liveRegion).toHaveTextContent('');
  });

  it('does NOT announce when items are removed (no click preceded the change)', async () => {
    const { rerender } = render(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        addedAnnouncement="5 items"
      />,
    );

    // Announcement text changes, but no user click happened
    rerender(
      <ShowMore
        label="Show more"
        onLoadMore={() => {}}
        hasMore
        addedAnnouncement="4 items"
      />,
    );

    const liveRegion = screen.getByRole('status');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(liveRegion).toHaveTextContent('');
  });

  it('announces exactly once after user clicks and loading completes', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();

    const { rerender } = render(
      <ShowMore
        label="Show more"
        onLoadMore={onLoadMore}
        hasMore
      />,
    );

    // 1. User clicks Show more
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // 2. Loading starts
    rerender(
      <ShowMore
        label="Show more"
        onLoadMore={onLoadMore}
        hasMore
        loading
      />,
    );

    // 3. Loading finishes with announcement
    rerender(
      <ShowMore
        label="Show more"
        onLoadMore={onLoadMore}
        hasMore
        loading={false}
        addedAnnouncement="5 more items loaded"
      />,
    );

    const liveRegion = screen.getByRole('status');
    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('5 more items loaded');
    });
  });

  it('moves focus to focusTargetRef only after user-triggered load', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLDivElement>();
    const onLoadMore = vi.fn();

    const { rerender } = render(
      <div>
        <div ref={ref} tabIndex={-1} data-testid="target">Card</div>
        <ShowMore
          label="Show more"
          onLoadMore={onLoadMore}
          hasMore
          focusTargetRef={ref}
        />
      </div>,
    );

    // Click show more
    await user.click(screen.getByRole('button', { name: 'Show more' }));

    // Loading starts
    rerender(
      <div>
        <div ref={ref} tabIndex={-1} data-testid="target">Card</div>
        <ShowMore
          label="Show more"
          onLoadMore={onLoadMore}
          hasMore
          loading
          focusTargetRef={ref}
        />
      </div>,
    );

    // Loading finishes
    rerender(
      <div>
        <div ref={ref} tabIndex={-1} data-testid="target">Card</div>
        <ShowMore
          label="Show more"
          onLoadMore={onLoadMore}
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

  it('does NOT move focus on a non-user-triggered load', async () => {
    const ref = createRef<HTMLDivElement>();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

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

    // Loading finishes without user click
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

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Focus should NOT have moved to target
    expect(document.activeElement).not.toBe(screen.getByTestId('target'));

    document.body.removeChild(button);
  });

  it('has no a11y violations', async () => {
    const { container } = render(
      <ShowMore label="Show more" onLoadMore={() => {}} hasMore />,
    );
    await expectNoA11yViolations(container);
  });
});
