import { Progress } from '@base-ui/react/progress';
import { cn } from '../../../lib/cn';

export interface ProgressBarProps {
  /** Current value (0 to 100). */
  value: number;
  /** Visible label describing the progress. */
  label: string;
  /** Show the numeric percentage next to the label. */
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  label,
  showValue,
  className,
}: ProgressBarProps) {
  return (
    <Progress.Root
      value={value}
      min={0}
      max={100}
      className={cn('flex flex-col gap-1.5', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <Progress.Label className="type-label text-text">
          {label}
        </Progress.Label>
        {showValue && (
          <Progress.Value className="type-metadata text-text-secondary">
            {(formattedValue) => formattedValue}
          </Progress.Value>
        )}
      </div>
      <Progress.Track
        className="h-2 w-full rounded-pill bg-border-subtle overflow-hidden"
      >
        <Progress.Indicator
          className={cn(
            'h-full bg-primary rounded-pill',
            'transition-[width] duration-[var(--motion-slow)] ease-standard',
            'motion-reduce:transition-none',
          )}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
