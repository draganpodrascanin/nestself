import { cn } from '../../../lib/cn';

export interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}

export function MetricCard({ label, value, hint, className }: MetricCardProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <dt className="type-metadata text-text-secondary">{label}</dt>
      <dd className="m-0 mt-2 text-[1.65rem] font-[var(--font-weight-label)] text-primary tabular-nums">
        {value}
      </dd>
      {hint ? <span className="mt-1 type-metadata text-text-secondary">{hint}</span> : null}
    </div>
  );
}
