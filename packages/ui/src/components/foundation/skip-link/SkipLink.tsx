import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface SkipLinkProps {
  href?: string;
  children: ReactNode;
  className?: string;
}

export function SkipLink({
  href = '#main',
  children,
  className,
}: SkipLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        'fixed left-0 top-0 z-[var(--z-sticky)] -translate-y-full bg-primary px-4 py-2 text-on-primary type-label transition-transform duration-[var(--motion-fast)]',
        'focus:translate-y-0',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      {children}
    </a>
  );
}
