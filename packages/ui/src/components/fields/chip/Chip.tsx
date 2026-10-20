import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface ChipProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Chip({
  pressed,
  onPressedChange,
  children,
  icon,
  disabled,
  className,
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex items-center gap-1.5 min-h-11 rounded-control border border-border-control bg-surface text-text px-3 py-1.5 type-body transition-colors duration-[var(--motion-fast)]',
        'aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-on-primary',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'pointer-coarse:min-h-12',
        className,
      )}
    >
      {icon ? <span aria-hidden className="inline-flex shrink-0">{icon}</span> : null}
      {children}
    </button>
  );
}

export interface ChipGroupProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function ChipGroup({ label, children, className }: ChipGroupProps) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {children}
    </div>
  );
}
