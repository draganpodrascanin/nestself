import { Button as BaseButton } from '@base-ui/react/button';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import type { ButtonVariant, ButtonSize } from '../button/Button';

export interface IconButtonProps {
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed data-pressed:bg-primary-pressed',
  secondary: 'border-border-control bg-surface text-primary hover:bg-tint active:bg-tint',
  ghost: 'border-transparent bg-transparent text-primary hover:bg-tint active:bg-tint',
  danger: 'btn-danger border-transparent bg-danger text-surface hover:brightness-95',
  'on-brand': 'border-transparent bg-on-primary text-primary hover:bg-accent hover:text-on-accent',
};

const sizeClasses: Record<ButtonSize, string> = {
  md: 'min-h-11 min-w-11 pointer-coarse:min-h-12 pointer-coarse:min-w-12',
  sm: 'min-h-11 min-w-11 pointer-coarse:min-h-12 pointer-coarse:min-w-12',
};

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  disabled,
  className,
  onClick,
}: IconButtonProps) {
  return (
    <BaseButton
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center rounded-control border transition-[background-color,border-color,color] duration-[var(--motion-fast)] ease-standard',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'data-disabled:border-transparent data-disabled:bg-disabled-surface data-disabled:text-disabled-text',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      <span aria-hidden className="inline-flex shrink-0">
        {icon}
      </span>
    </BaseButton>
  );
}
