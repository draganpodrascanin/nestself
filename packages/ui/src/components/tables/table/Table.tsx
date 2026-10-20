import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';

export type TableDensity = 'default' | 'compact';

export interface TableProps {
  caption?: string;
  density?: TableDensity;
  children: ReactNode;
  className?: string;
}

export function Table({
  caption,
  density = 'default',
  children,
  className,
}: TableProps) {
  return (
    <div
      className={cn('overflow-x-auto rounded-card border border-border-subtle bg-surface', className)}
      {...(caption
        ? {
            role: 'region' as const,
            tabIndex: 0,
            'aria-label': caption,
          }
        : undefined)}
    >
      <table className="w-full type-table" data-density={density}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Th({ numeric, children, className, ...rest }: ThProps) {
  return (
    <th
      {...rest}
      className={cn(
        'px-4 py-3 text-left font-[var(--font-weight-label)] text-text-secondary',
        'h-14 [[data-density="compact"]_&]:h-11 pointer-coarse:!h-14',
        numeric && 'text-right tabular-nums whitespace-nowrap',
        className,
      )}
    >
      {children}
    </th>
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Td({ numeric, children, className, ...rest }: TdProps) {
  return (
    <td
      {...rest}
      className={cn(
        'px-4 py-3',
        'h-14 [[data-density="compact"]_&]:h-11 pointer-coarse:!h-14',
        numeric && 'text-right tabular-nums whitespace-nowrap',
        className,
      )}
    >
      {children}
    </td>
  );
}
