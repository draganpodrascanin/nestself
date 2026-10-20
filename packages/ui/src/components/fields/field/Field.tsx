import { Field as BaseField } from '@base-ui/react/field';
import { Select as BaseSelect } from '@base-ui/react/select';
import { CaretDown, Check } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  optionalLabel?: string;
  children: ReactNode;
  id?: string;
  className?: string;
}

export function Field({
  label,
  description,
  error,
  required,
  optionalLabel,
  children,
  id,
  className,
}: FieldProps) {
  return (
    <BaseField.Root id={id} invalid={!!error} className={cn('flex flex-col gap-1.5', className)}>
      <BaseField.Label className="type-label text-text">
        {label}
        {required ? <span className="text-danger ml-0.5" aria-hidden>*</span> : null}
        {!required && optionalLabel ? <span className="text-text-secondary type-metadata ml-1">({optionalLabel})</span> : null}
      </BaseField.Label>
      {children}
      {description ? <BaseField.Description className="type-metadata text-text-secondary">{description}</BaseField.Description> : null}
      {error ? <BaseField.Error match className="type-metadata text-danger">{error}</BaseField.Error> : null}
    </BaseField.Root>
  );
}

export type Density = 'comfortable' | 'compact';

export interface InputProps {
  density?: Density;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  id?: string;
}

export function Input({
  density = 'comfortable',
  className,
  ...rest
}: InputProps) {
  return (
    <BaseField.Control
      {...rest}
      className={cn(
        'rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary px-3',
        'data-invalid:border-2 data-invalid:border-danger',
        'data-disabled:bg-tint data-disabled:text-text-secondary',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        density === 'compact' ? 'min-h-11' : 'min-h-12',
        className,
      )}
    />
  );
}

export interface TextareaProps {
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  rows?: number;
  className?: string;
}

export function Textarea({ className, ...rest }: TextareaProps) {
  return (
    <BaseField.Control
      render={<textarea />}
      {...rest as Record<string, unknown>}
      className={cn(
        'min-h-24 resize-y rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary px-3 py-2',
        'data-invalid:border-2 data-invalid:border-danger',
        'data-disabled:bg-tint data-disabled:text-text-secondary',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string | null) => void;
  disabled?: boolean;
  name?: string;
  /** Pass-through aria-label for standalone usage (without a `Field` wrapper). */
  'aria-label'?: string;
  /** Pass-through aria-labelledby to associate with an external label. */
  'aria-labelledby'?: string;
  className?: string;
}

export function Select({
  options,
  placeholder,
  value,
  defaultValue,
  onValueChange,
  disabled,
  name,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  className,
}: SelectProps) {
  return (
    <BaseSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <BaseSelect.Trigger
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'inline-flex items-center justify-between min-h-12 rounded-control border border-border-control bg-surface text-text px-3',
          'data-disabled:bg-tint data-disabled:text-text-secondary',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon>
          <CaretDown size={16} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner>
          <BaseSelect.Popup className="shadow-menu rounded-control bg-surface z-[var(--z-dropdown)] overflow-auto max-h-64 py-1">
            {options.map((opt) => (
              <BaseSelect.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  'flex items-center px-3 py-2 cursor-pointer',
                  'data-highlighted:bg-tint',
                  'data-selected:font-[var(--font-weight-label)]',
                )}
              >
                <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="ml-auto">
                  <Check size={16} aria-hidden="true" />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
