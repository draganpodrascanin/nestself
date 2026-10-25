import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Button } from '../../actions/button/Button';
import { cn } from '../../../lib/cn';

export interface ShowMoreProps {
  /** Label text for the button (e.g. "Show more"). */
  label: string;
  /** Called when the user activates "Show more". */
  onLoadMore: () => void;
  /** True while loading the next page. */
  loading?: boolean;
  /** Loading label for a11y. */
  loadingLabel?: string;
  /** Announced text when new items are added (for screen readers). */
  addedAnnouncement?: string;
  /** Whether there are more items to load. Hidden when false. */
  hasMore: boolean;
  /**
   * Ref to the first newly loaded item. When a load completes (announcement
   * is set), focus moves to this element so keyboard users land on the new
   * content instead of losing focus to `<body>`.
   */
  focusTargetRef?: RefObject<HTMLElement | null>;
  className?: string;
}

export function ShowMore({
  label,
  onLoadMore,
  loading = false,
  loadingLabel,
  addedAnnouncement,
  hasMore,
  focusTargetRef,
  className,
}: ShowMoreProps) {
  // Deferred announcement so the live region is in the DOM *before* its text
  // changes — screen readers detect the mutation and announce the new content.
  const [announced, setAnnounced] = useState('');
  const prevLoadingRef = useRef(loading);

  useEffect(() => {
    if (!addedAnnouncement) {
      // No announcement: schedule a clear (not synchronous to satisfy the lint rule)
      const clearId = setTimeout(() => setAnnounced(''), 0);
      return () => clearTimeout(clearId);
    }
    // Clear then re-set so repeated identical announcements are still picked up
    const clearId = setTimeout(() => setAnnounced(''), 0);
    const setId = setTimeout(() => setAnnounced(addedAnnouncement), 50);
    return () => {
      clearTimeout(clearId);
      clearTimeout(setId);
    };
  }, [addedAnnouncement]);

  // Move focus to the first new card when a load completes
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (wasLoading && !loading && addedAnnouncement && focusTargetRef?.current) {
      focusTargetRef.current.focus({ preventScroll: false });
    }
  }, [loading, addedAnnouncement, focusTargetRef]);

  const handleClick = () => {
    onLoadMore();
  };

  // Always render the container so the live region stays mounted and focus
  // doesn't drop to <body> when the last page loads.
  return (
    <div className={cn('flex flex-col items-center gap-2 py-4', className)}>
      {hasMore ? (
        <Button
          variant="secondary"
          size="md"
          onClick={handleClick}
          loading={loading}
          loadingLabel={loadingLabel}
        >
          {label}
        </Button>
      ) : null}
      <div role="status" aria-live="polite" className="sr-only">
        {announced}
      </div>
    </div>
  );
}
