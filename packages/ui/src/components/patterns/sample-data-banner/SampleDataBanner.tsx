import { WarningCircle } from '@phosphor-icons/react';
import { cn } from '../../../lib/cn';

export interface SampleDataBannerProps {
  message: string;
  className?: string;
}

export function SampleDataBanner({ message, className }: SampleDataBannerProps) {
  return (
    <div
      role="note"
      className={cn(
        'sticky top-0 z-50 flex items-center gap-3 min-h-11 px-4 py-2 bg-warning-surface text-warning type-metadata font-[var(--font-weight-label)]',
        className,
      )}
    >
      <WarningCircle weight="regular" size={20} aria-hidden className="shrink-0" />
      <span>{message}</span>
    </div>
  );
}
