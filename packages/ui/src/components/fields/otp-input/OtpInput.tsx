'use client';

import { forwardRef, useCallback } from 'react';
import { cn } from '../../../lib/cn';

export interface OtpInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'inputMode' | 'maxLength' | 'autoComplete' | 'pattern'
  > {
  length?: number;
}

export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(
  function OtpInput({ length = 6, className, onChange, onPaste, ...rest }, ref) {
    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        // Strip non-digits on regular typing
        const digits = e.target.value.replace(/\D/g, '').slice(0, length);
        if (digits !== e.target.value) {
          e.target.value = digits;
        }
        onChange?.(e);
      },
      [onChange, length],
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text/plain');
        const digits = pasted.replace(/\D/g, '').slice(0, length);
        const input = e.currentTarget;
        // Use native setter to ensure React detects the change
        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        nativeSetter?.call(input, digits);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        onPaste?.(e);
      },
      [length, onPaste],
    );

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        pattern={`[0-9]{${length}}`}
        className={cn(
          'w-full px-3 min-h-12 rounded-control border border-border-control bg-surface text-text text-center tracking-[0.3em] font-[var(--font-weight-label)]',
          'placeholder:text-text-secondary placeholder:tracking-normal',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          className,
        )}
        onChange={handleChange}
        onPaste={handlePaste}
        {...rest}
      />
    );
  },
);
