import { cn } from '../../../lib/cn';

export interface CostBreakdownRows {
  price: number;
  employerCovers: number;
  youPay: number;
}

export interface CostBreakdownLabels {
  price: string;
  employerCovers: string;
  youPay: string;
  timeZone: string;
  terms: string;
}

export interface CostBreakdownProps {
  rows: CostBreakdownRows;
  currency: string;
  locale: string;
  formatCurrency: (amount: number) => string;
  labels: CostBreakdownLabels;
  timeZone: string;
  onTermsClick: () => void;
  className?: string;
}

export function CostBreakdown({
  rows,
  currency: _currency,
  locale: _locale,
  formatCurrency,
  labels,
  timeZone,
  onTermsClick,
  className,
}: CostBreakdownProps) {
  if (process.env.NODE_ENV !== 'production') {
    if (rows.price !== rows.employerCovers + rows.youPay) {
      throw new Error(
        `CostBreakdown: inconsistent split — price (${rows.price}) !== employerCovers (${rows.employerCovers}) + youPay (${rows.youPay})`,
      );
    }
  }

  return (
    <div className={cn('mt-6', className)}>
      <dl>
        {/* Price row */}
        <div className="flex items-baseline justify-between gap-4 py-[0.55rem]">
          <dt className="text-text-secondary">{labels.price}</dt>
          <dd className="m-0 tabular-nums">{formatCurrency(rows.price)}</dd>
        </div>
        {/* Employer covers row */}
        <div className="flex items-baseline justify-between gap-4 py-[0.55rem]">
          <dt className="text-text-secondary">{labels.employerCovers}</dt>
          <dd className="m-0 tabular-nums">{formatCurrency(rows.employerCovers)}</dd>
        </div>
        {/* You pay row (emphasised) */}
        <div className="flex items-baseline justify-between gap-4 py-[0.55rem] border-t border-border-subtle mt-2 pt-[0.9rem] font-[var(--font-weight-label)]">
          <dt className="text-text">{labels.youPay}</dt>
          <dd className="m-0 tabular-nums">{formatCurrency(rows.youPay)}</dd>
        </div>
      </dl>
      <p className="mt-4 type-metadata text-text-secondary">{labels.timeZone}: {timeZone}</p>
      <button
        type="button"
        onClick={onTermsClick}
        className={cn(
          'mt-2 text-primary underline underline-offset-[0.2em] hover:text-primary-hover type-metadata',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        {labels.terms}
      </button>
    </div>
  );
}
