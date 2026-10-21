import { WarningCircle } from '@phosphor-icons/react/dist/ssr';
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
        'top-0 gap-3 min-h-11 px-4 py-2 sticky z-50 flex items-center bg-warning-surface type-metadata font-[var(--font-weight-label)] text-warning',
        className,
      )}
    >
      <WarningCircle weight="regular" size={20} aria-hidden className="shrink-0" />
      <span>{message}</span>
    </div>
  );
}
