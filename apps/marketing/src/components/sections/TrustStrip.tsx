import { Text } from '@nestself/ui';
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
    <section aria-label={ariaLabel} className={cn('py-8', className)}>
      <ul
        role="list"
        className="flex flex-wrap items-center justify-center gap-8 @max-[760px]:flex-col @max-[760px]:gap-4"
      >
        {items.map((item) => {
          const Icon = iconMap[item.icon];
          return (
            <li key={item.label} className="flex items-center gap-2">
              <Icon size={20} aria-hidden className="text-primary" />
              <Text as="span" typeRole="label" tone="secondary">
                {item.label}
              </Text>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
