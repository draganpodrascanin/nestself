import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import { Radio as BaseRadio } from '@base-ui/react/radio';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface RadioGroupProps {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function RadioGroup({
  label,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
  children,
  className,
}: RadioGroupProps) {
  return (
    <BaseRadioGroup
      aria-label={label}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      className={cn('flex flex-col gap-2', className)}
    >
      {children}
    </BaseRadioGroup>
  );
}

export interface RadioItemProps {
  value: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function RadioItem({
  value,
  disabled,
  children,
  className,
}: RadioItemProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 min-h-12 cursor-pointer',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <BaseRadio.Root
        value={value}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center size-[1.125rem] rounded-full border-2 border-border-control bg-surface transition-colors duration-[var(--motion-fast)]',
          'data-checked:border-primary',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          'data-disabled:opacity-50',
        )}
      >
        <BaseRadio.Indicator className="size-2.5 rounded-full bg-primary" />
      </BaseRadio.Root>
      <span className="type-body text-text">{children}</span>
    </label>
  );
}
