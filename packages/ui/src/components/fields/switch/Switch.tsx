'use client';

import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { useId } from 'react';
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
  const labelId = useId();
  return (
    <label
      className={cn(
        'gap-3 min-h-12 inline-flex cursor-pointer items-center',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      {children ? (
        <span id={labelId} className="type-body text-text">
          {children}
        </span>
      ) : null}
      <BaseSwitch.Root
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        aria-labelledby={children ? labelId : undefined}
        className={cn(
          'w-10 h-6 relative inline-flex items-center rounded-pill bg-border-control transition-colors duration-[var(--motion-standard)]',
          'data-checked:bg-primary',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          'data-disabled:opacity-50',
        )}
      >
        <BaseSwitch.Thumb
          className={cn(
            'shadow-sm translate-x-0.5 block size-[1.2rem] rounded-full bg-surface transition-transform duration-[var(--motion-standard)]',
            'data-checked:translate-x-4',
          )}
        />
      </BaseSwitch.Root>
    </label>
  );
}
