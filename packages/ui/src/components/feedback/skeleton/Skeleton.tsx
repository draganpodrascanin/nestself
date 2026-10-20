import { cn } from '../../../lib/cn';

export interface SkeletonProps {
  lines?: number;
  label: string;
  className?: string;
}

const lineWidths = ['100%', '70%', '85%'];

export function Skeleton({ lines = 3, label, className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('grid gap-3 w-full max-w-[26rem] mx-auto my-4', className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="block h-5 bg-border-subtle rounded-small motion-safe:animate-pulse"
          style={{ width: lineWidths[i % lineWidths.length] }}
        />
      ))}
    </div>
  );
}
