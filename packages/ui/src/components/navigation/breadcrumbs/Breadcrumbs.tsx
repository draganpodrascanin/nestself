import { CaretRight } from '@phosphor-icons/react';
import { cn } from '../../../lib/cn';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  /** Accessible label for the nav landmark. */
  label: string;
  /** Ordered breadcrumb items; the last is treated as the current page. */
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ label, items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className={className}>
      <ol className={cn('flex flex-wrap items-center gap-1 list-none m-0 p-0 type-metadata')}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1">
              {index > 0 && (
                <CaretRight
                  size={12}
                  aria-hidden
                  className="shrink-0 text-text-secondary"
                />
              )}
              {isLast ? (
                <span aria-current="page" className="text-text font-[var(--font-weight-label)]">
                  {item.label}
                </span>
              ) : !item.href ? (
                <span className="text-text-secondary">{item.label}</span>
              ) : (
                <a
                  href={item.href}
                  className={cn(
                    'text-text-secondary no-underline hover:text-text hover:underline',
                    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                    'rounded-sm',
                  )}
                >
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
