import { cn } from '../../../lib/cn';

export type DurationBandValue = 'under_5' | '5_to_15' | 'over_15';

export interface DurationBadgeProps {
  /** Actual duration in seconds. */
  durationSeconds?: number | null;
  /** Duration band label text (e.g. "Under 5 min"). */
  bandLabel?: string;
  className?: string;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '<1 min';
  return `${minutes} min`;
}

export function DurationBadge({
  durationSeconds,
  bandLabel,
  className,
}: DurationBadgeProps) {
  const displayText = durationSeconds != null
    ? formatDuration(durationSeconds)
    : bandLabel ?? null;

  if (!displayText) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5',
        'type-metadata text-text-secondary bg-tint',
        className,
      )}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 256 256"
        fill="currentColor"
        aria-hidden
        className="shrink-0"
      >
        <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z" />
      </svg>
      {displayText}
    </span>
  );
}
