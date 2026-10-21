import { cn } from '../../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'on-brand' | 'on-brand-outline';
export type ButtonSize = 'md' | 'sm';

export const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed data-pressed:bg-primary-pressed',
  secondary: 'border-border-control bg-surface text-primary hover:bg-tint active:bg-tint',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-tint active:bg-tint px-2',
  danger: 'btn-danger border-transparent bg-danger text-surface hover:brightness-95',
  'on-brand': 'border-transparent bg-on-primary text-primary hover:bg-accent hover:text-on-accent',
  /** Secondary action on a primary-coloured band: outlined, so the solid on-brand button stays the obvious first choice. */
  'on-brand-outline':
    'border-on-primary/70 bg-transparent text-on-primary hover:bg-on-primary/10 active:bg-on-primary/15 data-pressed:bg-on-primary/15',
};

export const sizeClasses: Record<ButtonSize, string> = {
  md: 'min-h-11 px-5 py-2.5 text-base pointer-coarse:min-h-12',
  sm: 'min-h-11 px-4 py-2 text-sm pointer-coarse:min-h-12',
};

/** Button class composition shared by Button and LinkButton (an anchor styled as a button). */
export function buttonClassNames({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {}) {
  return cn(
    'gap-2 leading-normal inline-flex items-center justify-center rounded-control border font-[var(--font-weight-label)] no-underline transition-[background-color,border-color,color] duration-[var(--motion-fast)] ease-standard',
    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
    'data-disabled:border-transparent data-disabled:bg-disabled-surface data-disabled:text-disabled-text',
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && 'w-full',
  );
}
