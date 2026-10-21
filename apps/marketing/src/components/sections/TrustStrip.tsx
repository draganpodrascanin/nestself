import { cn } from '@nestself/ui';
import { iconMap, type IconName } from './icons';

export interface TrustStripItem {
  icon: IconName;
  label: string;
}

export interface TrustStripProps {
  items: TrustStripItem[];
  ariaLabel?: string;
  className?: string;
}

export function TrustStrip({ items, ariaLabel, className }: TrustStripProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        'border-y border-border-subtle py-5 @max-[760px]:py-4',
        className,
      )}
    >
      <ul
        role="list"
        className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 @max-[760px]:grid @max-[760px]:grid-cols-2 @max-[760px]:gap-x-4 @max-[760px]:gap-y-4 @max-[380px]:grid-cols-1"
      >
        {items.map((item) => {
          const Icon = iconMap[item.icon];
          return (
            <li
              key={item.label}
              className="flex items-center gap-2.5 @max-[760px]:items-start"
            >
              <Icon
                size={22}
                weight="duotone"
                aria-hidden
                className="text-primary @max-[760px]:shrink-0 @max-[760px]:mt-0.5"
              />
              <span className="type-label text-text @max-[760px]:type-metadata">
                {item.label}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
