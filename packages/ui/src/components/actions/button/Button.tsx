import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../../lib/cn';

import { buttonClassNames, type ButtonSize, type ButtonVariant } from './buttonClasses';
export type { ButtonSize, ButtonVariant } from './buttonClasses';
export interface ButtonProps extends Omit<
  ComponentPropsWithoutRef<typeof BaseButton>,
  'className'
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keeps label and dimensions, announces busy, blocks repeat activation. */
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  leadingIcon,
  trailingIcon,
  fullWidth,
  className,
  children,
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <BaseButton
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event) => {
        if (loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(
        buttonClassNames({ variant, size, fullWidth }),
        loading && 'relative',
        className,
      )}
    >
      {leadingIcon ? (
        <span aria-hidden className="inline-flex shrink-0">
          {leadingIcon}
        </span>
      ) : null}
      <span className={cn(loading && 'opacity-70')}>{children}</span>
      {loading ? (
        <span className="sr-only" role="status">
          {loadingLabel ?? 'Loading'}
        </span>
      ) : null}
      {trailingIcon ? (
        <span aria-hidden className="inline-flex shrink-0">
          {trailingIcon}
        </span>
      ) : null}
    </BaseButton>
  );
}
