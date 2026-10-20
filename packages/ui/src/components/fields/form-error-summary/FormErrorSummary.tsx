import { forwardRef, useImperativeHandle, useRef } from 'react';
import { cn } from '../../../lib/cn';

export interface FormError {
  id: string;
  label: string;
  message: string;
}

export interface FormErrorSummaryProps {
  title: string;
  errors: FormError[];
  className?: string;
}

export interface FormErrorSummaryHandle {
  focus: () => void;
}

export const FormErrorSummary = forwardRef<FormErrorSummaryHandle, FormErrorSummaryProps>(
  function FormErrorSummary({ title, errors, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        containerRef.current?.focus();
      },
    }));

    if (errors.length === 0) return null;

    const handleLinkClick = (id: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      const el = document.getElementById(id);
      el?.focus();
    };

    return (
      <div
        ref={containerRef}
        role="alert"
        tabIndex={-1}
        className={cn(
          'rounded-control border-2 border-danger bg-surface p-4',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          className,
        )}
      >
        <h3 className="type-label text-danger mb-2">{title}</h3>
        <ul className="list-disc pl-5 space-y-1">
          {errors.map((err) => (
            <li key={err.id} className="type-metadata">
              <a
                href={`#${err.id}`}
                onClick={handleLinkClick(err.id)}
                className="text-danger underline hover:text-danger"
              >
                {err.label}
              </a>
              : {err.message}
            </li>
          ))}
        </ul>
      </div>
    );
  },
);
