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
        'grid gap-12 py-16',
        aside
          ? 'grid-cols-[minmax(0,3fr)_minmax(0,1fr)] @max-[760px]:grid-cols-1'
          : 'mx-auto max-w-[720px]',
        className,
      )}
    >
      <div className="prose prose-text max-w-none">{children}</div>
      {aside && (
        <aside className="@max-[760px]:order-first">{aside}</aside>
      )}
    </div>
  );
}
