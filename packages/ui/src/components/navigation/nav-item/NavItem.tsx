import type { ComponentType, ReactNode } from 'react';
import type { IconProps as PhosphorIconProps } from '@phosphor-icons/react';
import { cn } from '../../../lib/cn';
import { NavIcon } from '../../foundation/icon/Icon';

export interface NavItemProps {
  href: string;
  icon: ComponentType<PhosphorIconProps>;
  label: string;
  active?: boolean;
  /** Render prop for router links. Receives className, aria-current and children. */
  render?: (props: {
    href: string;
    className: string;
    'aria-current': 'page' | undefined;
    children: ReactNode;
  }) => ReactNode;
  /** `bottom` items share the bar width equally, shrink below their content width and use the 0.6875rem label. */
  variant?: 'sidebar' | 'bottom';
  className?: string;
}

export function NavItem({
  href,
  icon,
  label,
  active = false,
  render,
  variant = 'sidebar',
  className,
}: NavItemProps) {
  const classes = cn(
    'gap-1 min-h-12 py-1.5 flex flex-col items-center text-text-secondary no-underline',
    variant === 'bottom'
      ? 'basis-0 min-w-0 px-1 leading-tight flex-1 text-center text-[0.6875rem]'
      : 'px-2 type-metadata',
    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
    active && 'font-[var(--font-weight-label)] text-primary',
    className,
  );
  const ariaCurrent = active ? ('page' as const) : undefined;
  const children = (
    <>
      <NavIcon icon={icon} active={active} size={20} />
      <span className={cn(variant === 'bottom' && 'max-w-full truncate')}>{label}</span>
    </>
  );

  if (render) {
    return render({ href, className: classes, 'aria-current': ariaCurrent, children });
  }

  return (
    <a href={href} className={classes} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}
