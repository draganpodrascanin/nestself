'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Button } from '../../actions/button/Button';
import { useAnnounce } from '../../foundation/live-region/LiveRegion';
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

/**
 * "Show more" button for paginated lists. Announces new items through the
 * nearest `AnnouncerProvider` and moves focus to the first new item.
 *
 * Only user-initiated loads (click) trigger an announcement, preventing
 * spurious announcements on first render, refetch or item removal.
 */
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
  const { announce } = useAnnounce();
  const prevLoadingRef = useRef(loading);

  // Only announce/focus after a user-triggered click on "Show more".
  // Prevents spurious announcements on first paint, refetch, or item removal.
  const userTriggeredRef = useRef(false);

  const handleClick = () => {
    userTriggeredRef.current = true;
    onLoadMore();
  };

  // Announce and focus only when a user-triggered load finishes
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (userTriggeredRef.current && wasLoading && !loading && addedAnnouncement) {
      userTriggeredRef.current = false;

      // Focus the first new item
      if (focusTargetRef?.current) {
        focusTargetRef.current.focus({ preventScroll: false });
      }

      announce(addedAnnouncement);
    }
  }, [loading, addedAnnouncement, focusTargetRef, announce]);

  // Always render the container so focus doesn't drop to <body> when the
  // last page loads and the button disappears.
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
    </div>
  );
}
