'use client';

import { Field as BaseField } from '@base-ui/react/field';
import { Select as BaseSelect } from '@base-ui/react/select';
import { CaretDown, Check } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import { m, MotionFeatures, useMotionPreset } from '../../../motion';

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
    <BaseField.Root id={id} invalid={!!error} className={cn('gap-1.5 flex flex-col', className)}>
      <BaseField.Label className="type-label text-text">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
        {!required && optionalLabel ? (
          <span className="ml-1 type-metadata text-text-secondary">({optionalLabel})</span>
        ) : null}
      </BaseField.Label>
      {children}
      {description ? (
        <BaseField.Description className="type-metadata text-text-secondary">
          {description}
        </BaseField.Description>
      ) : null}
      {error ? (
        <BaseField.Error match className="type-metadata text-danger">
          {error}
        </BaseField.Error>
      ) : null}
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
  autoComplete?: string;
  'aria-describedby'?: string;
}

export function Input({ density = 'comfortable', className, ...rest }: InputProps) {
  return (
    <BaseField.Control
      {...rest}
      className={cn(
        'px-3 rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary',
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
      {...(rest as Record<string, unknown>)}
      className={cn(
        'min-h-24 px-3 py-2 resize-y rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary',
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
  const [open, setOpen] = useState(false);
  const popupMotion = useMotionPreset('popover');
  /*
   * The portal is always rendered: Base UI mounts the closed popup early (on
   * focus) so typing on the closed trigger can pick an option, and keeps it
   * mounted after closing. The popup therefore animates by `open` instead of
   * through AnimatePresence; one that mounts closed starts at its exit state.
   */
  const motionElement = (
    <m.div
      initial={open ? popupMotion.initial : false}
      animate={open ? popupMotion.animate : popupMotion.exit}
    />
  );

  return (
    <BaseSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
      items={options.map((opt) => ({ value: opt.value, label: opt.label }))}
      open={open}
      onOpenChange={setOpen}
    >
      <BaseSelect.Trigger
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'group min-h-12 px-3 inline-flex items-center justify-between rounded-control border border-border-control bg-surface text-text',
          'data-disabled:bg-tint data-disabled:text-text-secondary',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          className,
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon
          className={cn(
            'transition-transform duration-[var(--motion-standard)] ease-standard motion-reduce:transition-none',
            'group-data-popup-open:rotate-180',
          )}
        >
          <CaretDown size={16} aria-hidden />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <MotionFeatures>
        <BaseSelect.Portal>
          <BaseSelect.Positioner className="z-[var(--z-dropdown)]">
            <BaseSelect.Popup
              render={motionElement}
              className="max-h-64 py-1 z-[var(--z-dropdown)] overflow-auto rounded-control bg-surface shadow-menu origin-[var(--transform-origin)]"
            >
              {options.map((opt) => (
                <BaseSelect.Item
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  className={cn(
                    'px-3 py-2 flex cursor-pointer items-center',
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
      </MotionFeatures>
    </BaseSelect.Root>
  );
}
