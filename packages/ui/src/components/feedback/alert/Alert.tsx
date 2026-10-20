import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}

const toneClasses: Record<AlertTone, string> = {
  info: 'text-info bg-info-surface',
  success: 'text-success bg-success-surface',
  warning: 'text-warning bg-warning-surface',
  danger: 'text-danger bg-danger-surface',
};

export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  className,
}: AlertProps) {
  const isUrgent = tone === 'warning' || tone === 'danger';
  return (
    <div
      role={isUrgent ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 p-4 rounded-control',
        toneClasses[tone],
        className,
      )}
    >
      {icon ? <span aria-hidden className="inline-flex shrink-0">{icon}</span> : null}
      <div className="flex-1 min-w-0">
        {title ? <p className="font-[var(--font-weight-label)] mb-1">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
