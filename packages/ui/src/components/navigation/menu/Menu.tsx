import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { ReactNode } from 'react';
import { Check } from '@phosphor-icons/react/dist/ssr';
import { cn } from '../../../lib/cn';

export interface MenuProps {
  children: ReactNode;
}

export function Menu({ children }: MenuProps) {
  return <BaseMenu.Root>{children}</BaseMenu.Root>;
}

export interface MenuTriggerProps {
  children: ReactNode;
  variant?: 'default' | 'quiet';
  className?: string;
}

const triggerDefault =
  'inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 rounded-control border border-border-control bg-surface text-text cursor-pointer';
const triggerQuiet =
  'inline-flex items-center justify-center min-h-11 px-2 py-2 gap-1.5 rounded-control border-0 bg-transparent text-text-secondary hover:text-primary hover:bg-tint cursor-pointer pointer-coarse:min-h-12';

export function MenuTrigger({ children, variant = 'default', className }: MenuTriggerProps) {
  return (
    <BaseMenu.Trigger
      className={cn(
        variant === 'quiet' ? triggerQuiet : triggerDefault,
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        variant === 'default' && 'pointer-coarse:min-h-12',
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
  'aria-label'?: string;
}

export function MenuPopup({ children, className, 'aria-label': ariaLabel }: MenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner>
        <BaseMenu.Popup
          aria-label={ariaLabel}
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

export interface MenuLinkItemProps {
  href: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  current?: boolean;
  closeOnClick?: boolean;
}

export function MenuLinkItem({
  href,
  children,
  className,
  onClick,
  current,
  closeOnClick: _closeOnClick = true,
}: MenuLinkItemProps) {
  return (
    <BaseMenu.LinkItem
      href={href}
      onClick={onClick}
      aria-current={current ? 'true' : undefined}
      className={cn(
        'flex items-center min-h-11 px-3 py-2 rounded-small cursor-pointer',
        'no-underline text-text justify-between gap-3',
        'data-highlighted:bg-tint',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      {children}
      {current && <Check size={16} aria-hidden />}
    </BaseMenu.LinkItem>
  );
}
