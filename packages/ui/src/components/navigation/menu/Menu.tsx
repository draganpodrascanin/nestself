import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface MenuProps {
  children: ReactNode;
}

export function Menu({ children }: MenuProps) {
  return <BaseMenu.Root>{children}</BaseMenu.Root>;
}

export interface MenuTriggerProps {
  children: ReactNode;
  className?: string;
}

export function MenuTrigger({ children, className }: MenuTriggerProps) {
  return (
    <BaseMenu.Trigger
      className={cn(
        'inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 rounded-control border border-border-control bg-surface text-text cursor-pointer',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'pointer-coarse:min-h-12',
        className,
      )}
    >
      {children}
    </BaseMenu.Trigger>
  );
}

export interface MenuPopupProps {
  children: ReactNode;
  className?: string;
}

export function MenuPopup({ children, className }: MenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner>
        <BaseMenu.Popup
          className={cn(
            'shadow-menu rounded-control bg-surface z-[var(--z-dropdown)] p-1',
            className,
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function MenuItem({ children, onClick, className }: MenuItemProps) {
  return (
    <BaseMenu.Item
      onClick={onClick}
      className={cn(
        'flex items-center min-h-11 px-3 py-2 rounded-small cursor-pointer',
        'data-highlighted:bg-tint',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      {children}
    </BaseMenu.Item>
  );
}
