import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  children?: ReactNode;
  className?: string;
}

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  name,
  children,
  className,
}: SwitchProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-3 min-h-12 cursor-pointer',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {children ? <span className="type-body text-text">{children}</span> : null}
      <BaseSwitch.Root
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        className={cn(
          'relative inline-flex items-center w-10 h-6 rounded-pill bg-border-control transition-colors duration-[var(--motion-standard)]',
          'data-checked:bg-primary',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          'data-disabled:opacity-50',
        )}
      >
        <BaseSwitch.Thumb
          className={cn(
            'block size-[1.2rem] rounded-full bg-surface shadow-sm transition-transform duration-[var(--motion-standard)] translate-x-0.5',
            'data-checked:translate-x-4',
          )}
        />
      </BaseSwitch.Root>
    </label>
  );
}
