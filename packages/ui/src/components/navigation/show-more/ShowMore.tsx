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

  // Only announce/focus after a user-triggered click on "Show more".
  // Prevents spurious announcements on first paint, refetch, or item removal.
  const userTriggeredRef = useRef(false);

  const handleClick = () => {
    userTriggeredRef.current = true;
    onLoadMore();
  };

  // Single effect: announce and focus only when a user-triggered load finishes
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (userTriggeredRef.current && wasLoading && !loading && addedAnnouncement) {
      userTriggeredRef.current = false;

      // Focus the first new item
      if (focusTargetRef?.current) {
        focusTargetRef.current.focus({ preventScroll: false });
      }

      // Clear then re-set so repeated identical announcements are still picked up
      const clearId = setTimeout(() => setAnnounced(''), 0);
      const setId = setTimeout(() => setAnnounced(addedAnnouncement), 50);
      return () => {
        clearTimeout(clearId);
        clearTimeout(setId);
      };
    }

    // Not user-triggered: keep region empty (avoids stale text from prior loads)
    if (!userTriggeredRef.current) {
      const clearId = setTimeout(() => setAnnounced(''), 0);
      return () => clearTimeout(clearId);
    }
  }, [loading, addedAnnouncement, focusTargetRef]);

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
