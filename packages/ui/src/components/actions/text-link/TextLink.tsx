import { Button as BaseButton } from '@base-ui/react/button';
import type { ReactNode, ComponentPropsWithoutRef } from 'react';
import { cn } from '../../../lib/cn';

export interface TextLinkProps {
  href: string;
  trailingArrow?: boolean;
  children: ReactNode;
  className?: string;
}

export function TextLink({
  href,
  trailingArrow,
  children,
  className,
}: TextLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        'text-primary underline underline-offset-[0.2em] hover:text-primary-hover',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      {children}
      {trailingArrow ? <span aria-hidden className="ml-1">&rarr;</span> : null}
    </a>
  );
}

export interface LinkButtonProps extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'className' | 'render'> {
  href: string;
  children: ReactNode;
  className?: string;
}

export function LinkButton({
  href,
  children,
  className,
  ...rest
}: LinkButtonProps) {
  return (
    <BaseButton
      {...rest}
      // eslint-disable-next-line jsx-a11y/anchor-has-content -- Base UI renders children into the anchor
      render={<a href={href} />}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control border border-transparent bg-primary text-on-primary px-5 py-2.5 min-h-11 font-[var(--font-weight-label)] leading-normal no-underline transition-[background-color,border-color,color] duration-[var(--motion-fast)] ease-standard hover:bg-primary-hover',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'pointer-coarse:min-h-12',
        className,
      )}
    >
      {children}
    </BaseButton>
  );
}
