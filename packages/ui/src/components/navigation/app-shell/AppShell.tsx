import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export type AppShellMaxWidth = 'employee' | 'hr' | 'form';

export interface AppShellProps {
  sidebar?: ReactNode;
  topbar?: ReactNode;
  bottomBar?: ReactNode;
  children: ReactNode;
  maxWidth?: AppShellMaxWidth;
  className?: string;
}

const maxWidthClasses: Record<AppShellMaxWidth, string> = {
  employee: 'max-w-employee',
  hr: 'max-w-hr',
  form: 'max-w-form',
};

export function AppShell({
  sidebar,
  topbar,
  bottomBar,
  children,
  maxWidth,
  className,
}: AppShellProps) {
  return (
    <div className={cn('@container min-h-screen', className)}>
      <div
        className={cn(
          'grid min-h-screen',
          sidebar && 'grid-cols-1 @min-[1024px]:grid-cols-[15.5rem_1fr]',
        )}
      >
        {sidebar ? (
          <aside className="hidden @min-[1024px]:block border-r border-border-subtle bg-surface overflow-y-auto">
            {sidebar}
          </aside>
        ) : null}
        <div className="flex flex-col min-h-screen">
          {topbar ? (
            <div className="min-h-[4.5rem] flex items-center border-b border-border-subtle bg-surface px-6">
              {topbar}
            </div>
          ) : null}
          <main id="main" tabIndex={-1} className={cn('flex-1 px-6 py-8', maxWidth && maxWidthClasses[maxWidth])}>
            {children}
          </main>
          {bottomBar ? (
            <div className="@min-[1024px]:hidden border-t border-border-subtle bg-surface min-h-16 pb-[env(safe-area-inset-bottom)]">
              {bottomBar}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
