import type { ReactNode, ComponentPropsWithoutRef } from 'react';
import { cn } from '../../../lib/cn';
import { buttonClassNames, type ButtonSize, type ButtonVariant } from '../button/buttonClasses';

export interface TextLinkProps {
  href: string;
  trailingArrow?: boolean;
  children: ReactNode;
  className?: string;
}

export function TextLink({ href, trailingArrow, children, className }: TextLinkProps) {
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
      {trailingArrow ? (
        <span aria-hidden className="ml-1">
          &rarr;
        </span>
      ) : null}
    </a>
  );
}

export interface LinkButtonProps extends Omit<ComponentPropsWithoutRef<'a'>, 'className' | 'href'> {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** A navigation link that looks like a button. It stays a real anchor (role link), never a button. */
export function LinkButton({
  href,
  children,
  className,
  variant = 'primary',
  size = 'md',
  fullWidth,
  ...rest
}: LinkButtonProps) {
  return (
    <a
      href={href}
      className={cn(buttonClassNames({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {children}
    </a>
  );
}
