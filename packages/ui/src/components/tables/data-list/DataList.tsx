import { cn } from '../../../lib/cn';

export interface DataListItem {
  term: string;
  description: string;
  numeric?: boolean;
}

export interface DataListProps {
  items: DataListItem[];
  total?: { term: string; description: string };
  className?: string;
}

export function DataList({ items, total, className }: DataListProps) {
  const allItems: DataListItem[] = total
    ? [...items, { ...total, numeric: true }]
    : items;
  return (
    <dl className={cn('mt-6', className)}>
      {allItems.map((item, i) => {
        const isTotal = total && i === allItems.length - 1;
        return (
          <div
            key={item.term}
            className={cn(
              'flex items-baseline justify-between gap-4 py-2',
              isTotal && 'border-t border-border-subtle mt-2 pt-3.5 font-[var(--font-weight-label)]',
            )}
          >
            <dt className={cn(isTotal ? 'text-text' : 'text-text-secondary')}>
              {item.term}
            </dt>
            <dd className={cn('m-0', (item.numeric ?? true) && 'tabular-nums')}>
              {item.description}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
