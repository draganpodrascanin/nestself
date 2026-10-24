'use client';

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  children?: ReactNode;
  className?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  name,
  children,
  className,
}: CheckboxProps) {
  const labelId = useId();
  return (
    <label
      className={cn(
        'gap-2.5 min-h-12 inline-flex cursor-pointer items-center',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <BaseCheckbox.Root
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        aria-labelledby={children ? labelId : undefined}
        className={cn(
          'rounded-sm inline-flex size-[1.125rem] items-center justify-center border-2 border-border-control bg-surface transition-colors duration-[var(--motion-fast)]',
          'data-checked:border-primary data-checked:bg-primary',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          'data-disabled:opacity-50',
        )}
      >
        <BaseCheckbox.Indicator className="text-on-primary">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2 6l3 3 5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {children ? (
        <span id={labelId} className="type-body text-text">
          {children}
        </span>
      ) : null}
    </label>
  );
}

export interface CheckboxGroupProps {
  legend: string;
  children: ReactNode;
  className?: string;
  /** Ids of a hint or error message that describes the whole group. */
  'aria-describedby'?: string;
}

export function CheckboxGroup({
  legend,
  children,
  className,
  'aria-describedby': ariaDescribedBy,
}: CheckboxGroupProps) {
  return (
    <fieldset aria-describedby={ariaDescribedBy} className={cn('gap-2 flex flex-col', className)}>
      <legend className="mb-1 type-label text-text">{legend}</legend>
      {children}
    </fieldset>
  );
}
