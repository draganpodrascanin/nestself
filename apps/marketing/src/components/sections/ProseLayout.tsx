import type { ReactNode } from 'react';
import { cn } from '@nestself/ui';

export interface ProseLayoutProps {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}

export function ProseLayout({ children, aside, className }: ProseLayoutProps) {
  return (
    <div
      className={cn(
        'gap-12 py-16',
        aside
          ? 'grid grid-cols-[minmax(0,68ch)_minmax(0,1fr)] @max-[1024px]:grid-cols-1'
          : '',
        className,
      )}
    >
      <div data-prose="" className="max-w-[68ch]">
        {children}
      </div>
      {aside && (
        <aside className="@max-[1024px]:order-first">{aside}</aside>
      )}
    </div>
  );
}
