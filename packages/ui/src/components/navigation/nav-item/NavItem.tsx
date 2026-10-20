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
  className?: string;
}

export function NavItem({
  href,
  icon,
  label,
  active = false,
  render,
  className,
}: NavItemProps) {
  const classes = cn(
    'flex flex-col items-center gap-1 min-h-12 px-2 py-1.5 text-text-secondary type-metadata no-underline',
    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
    active && 'text-primary font-[var(--font-weight-label)]',
    className,
  );
  const ariaCurrent = active ? ('page' as const) : undefined;
  const children = (
    <>
      <NavIcon icon={icon} active={active} size={20} />
      <span>{label}</span>
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
