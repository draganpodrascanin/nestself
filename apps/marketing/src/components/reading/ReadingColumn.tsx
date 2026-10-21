import type { ReactNode } from 'react';
import { cn } from '@nestself/ui';

export interface ReadingColumnProps {
  children: ReactNode;
  className?: string;
}

export function ReadingColumn({ children, className }: ReadingColumnProps) {
  return (
    <div className={cn('mx-auto w-full max-w-[720px]', className)}>
      {children}
    </div>
  );
}
