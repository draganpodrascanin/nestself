import { useRef } from 'react';
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
  className?: string;
}

export function ShowMore({
  label,
  onLoadMore,
  loading = false,
  loadingLabel,
  addedAnnouncement,
  hasMore,
  className,
}: ShowMoreProps) {
  const liveRef = useRef<HTMLDivElement>(null);

  if (!hasMore) return null;

  const handleClick = () => {
    onLoadMore();
    // The announcement is expected to be set by the caller after data loads
  };

  return (
    <div className={cn('flex flex-col items-center gap-2 py-4', className)}>
      <Button
        variant="secondary"
        size="md"
        onClick={handleClick}
        loading={loading}
        loadingLabel={loadingLabel}
      >
        {label}
      </Button>
      {addedAnnouncement ? (
        <div ref={liveRef} role="status" aria-live="polite" className="sr-only">
          {addedAnnouncement}
        </div>
      ) : null}
    </div>
  );
}
