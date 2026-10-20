import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from '@phosphor-icons/react';
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface DialogProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

export function Dialog({ children, open, onOpenChange, defaultOpen }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {children}
    </BaseDialog.Root>
  );
}

export interface DialogTriggerProps {
  children: ReactNode;
  className?: string;
}

/**
 * When `children` is a single React element (e.g. `<Button>`), the element
 * itself becomes the trigger via Base UI's `render` prop, avoiding a nested
 * `<button>` inside the trigger's own `<button>`.  When `children` is text
 * or a fragment the trigger wraps it in a `<button>` as before.
 */
export function DialogTrigger({ children, className }: DialogTriggerProps) {
  if (isSingleElement(children)) {
    return (
      <BaseDialog.Trigger render={children as ReactElement} className={className} />
    );
  }
  return <BaseDialog.Trigger className={className}>{children}</BaseDialog.Trigger>;
}

function isSingleElement(children: ReactNode): boolean {
  try {
    const child = Children.only(children);
    return isValidElement(child);
  } catch {
    return false;
  }
}

export interface DialogContentProps {
  children: ReactNode;
  title: string;
  description?: string;
  closeLabel?: string;
  className?: string;
}

export function DialogContent({
  children,
  title,
  description,
  closeLabel = 'Close',
  className,
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 bg-scrim z-[var(--z-scrim)]" />
      <BaseDialog.Popup
        aria-modal="true"
        className={cn(
          'fixed inset-0 m-auto h-fit w-[min(calc(100%-2rem),37rem)] max-h-[min(85vh,52rem)] overflow-auto',
          'rounded-modal border border-border-subtle bg-surface p-8 pointer-coarse:p-6 shadow-modal z-[var(--z-dialog)]',
          className,
        )}
      >
        <BaseDialog.Title className="type-section-title pr-8 mb-5">
          {title}
        </BaseDialog.Title>
        {description ? (
          <BaseDialog.Description className="text-text-secondary mb-4">
            {description}
          </BaseDialog.Description>
        ) : null}
        <BaseDialog.Close
          className={cn(
            'absolute right-4 top-4 inline-flex items-center justify-center min-h-11 min-w-11 rounded-control bg-surface text-text border-0',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            'pointer-coarse:min-h-12 pointer-coarse:min-w-12',
          )}
          aria-label={closeLabel}
        >
          <X size={20} aria-hidden />
        </BaseDialog.Close>
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export interface DialogActionsProps {
  children: ReactNode;
  className?: string;
}

export function DialogActions({ children, className }: DialogActionsProps) {
  return (
    <div className={cn('flex flex-wrap justify-end gap-3 mt-7', className)}>
      {children}
    </div>
  );
}
