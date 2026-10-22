'use client';

import { useState, forwardRef } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react/dist/ssr';
import { cn } from '../../../lib/cn';

export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  showLabel?: string;
  hideLabel?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      showLabel = 'Show password',
      hideLabel = 'Hide password',
      className,
      ...rest
    },
    ref,
  ) {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn(
            'w-full pr-12 px-3 min-h-12 rounded-control border border-border-control bg-surface text-text placeholder:text-text-secondary',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            className,
          )}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          className="absolute right-0 top-0 h-full px-3 flex items-center text-text-secondary hover:text-text"
        >
          {visible ? (
            <EyeSlash size={20} aria-hidden />
          ) : (
            <Eye size={20} aria-hidden />
          )}
        </button>
      </div>
    );
  },
);
