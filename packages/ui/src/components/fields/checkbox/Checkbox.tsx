import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
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
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 min-h-12 cursor-pointer',
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
        className={cn(
          'inline-flex items-center justify-center size-[1.125rem] rounded-sm border-2 border-border-control bg-surface transition-colors duration-[var(--motion-fast)]',
          'data-checked:bg-primary data-checked:border-primary',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          'data-disabled:opacity-50',
        )}
      >
        <BaseCheckbox.Indicator className="text-on-primary">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {children ? <span className="type-body text-text">{children}</span> : null}
    </label>
  );
}

export interface CheckboxGroupProps {
  legend: string;
  children: ReactNode;
  className?: string;
}

export function CheckboxGroup({ legend, children, className }: CheckboxGroupProps) {
  return (
    <fieldset className={cn('flex flex-col gap-2', className)}>
      <legend className="type-label text-text mb-1">{legend}</legend>
      {children}
    </fieldset>
  );
}
