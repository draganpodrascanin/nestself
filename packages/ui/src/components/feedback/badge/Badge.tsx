import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-tint text-primary',
  success: 'text-success bg-success-surface',
  warning: 'text-warning bg-warning-surface',
  danger: 'text-danger bg-danger-surface',
  info: 'text-info bg-info-surface',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 min-h-7 rounded-pill px-2.5 py-0.5 type-metadata font-[var(--font-weight-label)]',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
