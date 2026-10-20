import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}

/**
 * A single metric display: label above, large value below.
 *
 * Does **not** use definition-list semantics (`<dt>`/`<dd>`) because a
 * standalone card is rarely inside a `<dl>`.  Wrap several cards in
 * `<MetricGroup>` for a labelled group row.
 */
export function MetricCard({ label, value, hint, className }: MetricCardProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <span className="type-metadata text-text-secondary">{label}</span>
      <p className="m-0 mt-2 text-[1.65rem] font-[var(--font-weight-label)] text-primary tabular-nums">
        {value}
      </p>
      {hint ? <span className="mt-1 type-metadata text-text-secondary">{hint}</span> : null}
    </div>
  );
}

export interface MetricGroupProps {
  /** Accessible group label (e.g. "Key metrics"). */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A `role="group"` wrapper for a row of `MetricCard` components,
 * with an accessible `aria-label`.
 */
export function MetricGroup({ label, children, className }: MetricGroupProps) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-6', className)}>
      {children}
    </div>
  );
}
