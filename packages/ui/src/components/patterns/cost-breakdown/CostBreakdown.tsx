import { cn } from '../../../lib/cn';
import { DataList } from '../../tables/data-list';

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
      <DataList
        items={[
          { term: labels.price, description: formatCurrency(rows.price) },
          { term: labels.employerCovers, description: formatCurrency(rows.employerCovers) },
        ]}
        total={{ term: labels.youPay, description: formatCurrency(rows.youPay) }}
        className="mt-0"
      />
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
