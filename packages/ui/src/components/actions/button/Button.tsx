import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-brand';
export type ButtonSize = 'md' | 'sm';
export interface ButtonProps extends Omit<ComponentPropsWithoutRef<typeof BaseButton>, 'className'> {
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

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed data-pressed:bg-primary-pressed',
  secondary: 'border-border-control bg-surface text-primary hover:bg-tint active:bg-tint',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-tint active:bg-tint px-2',
  danger: 'btn-danger border-transparent bg-danger text-surface hover:brightness-95',
  'on-brand': 'border-transparent bg-on-primary text-primary hover:bg-accent hover:text-on-accent',
};
const sizeClasses: Record<ButtonSize, string> = {
  md: 'min-h-11 px-5 py-2.5 text-base pointer-coarse:min-h-12',
  sm: 'min-h-11 px-4 py-2 text-sm pointer-coarse:min-h-12',
};

export function Button({ variant = 'primary', size = 'md', loading = false, loadingLabel, leadingIcon, trailingIcon, fullWidth, className, children, disabled, onClick, ...rest }: ButtonProps) {
  return (
    <BaseButton
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event) => { if (loading) { event.preventDefault(); return; } onClick?.(event); }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control border font-[var(--font-weight-label)] leading-normal no-underline transition-[background-color,border-color,color] duration-[var(--motion-fast)] ease-standard',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'data-disabled:border-transparent data-disabled:bg-disabled-surface data-disabled:text-disabled-text',
        variantClasses[variant], sizeClasses[size], fullWidth && 'w-full', loading && 'relative', className,
      )}
    >
      {leadingIcon ? <span aria-hidden className="inline-flex shrink-0">{leadingIcon}</span> : null}
      <span className={cn(loading && 'opacity-70')}>{children}</span>
      {loading ? <span className="sr-only" role="status">{loadingLabel ?? 'Loading'}</span> : null}
      {trailingIcon ? <span aria-hidden className="inline-flex shrink-0">{trailingIcon}</span> : null}
    </BaseButton>
  );
}
