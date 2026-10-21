import type { ReactNode } from 'react';
import { ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { cn } from '../../../lib/cn';

export interface CoverageNoticeProps {
  children: ReactNode;
  className?: string;
}

export function CoverageNotice({ children, className }: CoverageNoticeProps) {
  return (
    <div className={cn('gap-3 flex items-center type-metadata text-text-secondary', className)}>
      <ShieldCheck weight="regular" size={20} aria-hidden className="shrink-0 text-primary" />
      <span>{children}</span>
    </div>
  );
}
