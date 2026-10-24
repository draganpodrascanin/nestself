'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from '@phosphor-icons/react/dist/ssr';
import { Children, createContext, isValidElement, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import { useOpenState } from '../../../lib/use-open-state';
import { AnimatePresence, m, MotionFeatures, useMotionPreset } from '../../../motion';

/** Lets `DialogContent` see the open state so the exit animation can play before unmount. */
const DialogOpenContext = createContext(false);

export interface DialogProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

export function Dialog({ children, open, onOpenChange, defaultOpen }: DialogProps) {
  const [isOpen, setOpen] = useOpenState({ open, defaultOpen, onOpenChange });
  return (
    <BaseDialog.Root open={isOpen} onOpenChange={setOpen}>
      <DialogOpenContext.Provider value={isOpen}>{children}</DialogOpenContext.Provider>
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
    return <BaseDialog.Trigger render={children as ReactElement} className={className} />;
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
  const open = useContext(DialogOpenContext);
  const backdropMotion = useMotionPreset('backdrop');
  const popupMotion = useMotionPreset('dialog');
  return (
    <MotionFeatures>
      <AnimatePresence>
        {open ? (
          <BaseDialog.Portal keepMounted>
            <BaseDialog.Backdrop
              className="inset-0 fixed z-[var(--z-scrim)] bg-scrim"
              render={<m.div {...backdropMotion} />}
            />
            <BaseDialog.Popup
              aria-modal="true"
              render={<m.div {...popupMotion} />}
              className={cn(
                'inset-0 fixed m-auto h-fit max-h-[min(85vh,52rem)] w-[min(calc(100%-2rem),37rem)] overflow-auto',
                'p-8 pointer-coarse:p-6 z-[var(--z-dialog)] rounded-modal border border-border-subtle bg-surface shadow-modal',
                className,
              )}
            >
              <BaseDialog.Title className="pr-8 mb-5 type-section-title">{title}</BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="mb-4 text-text-secondary">
                  {description}
                </BaseDialog.Description>
              ) : null}
              <BaseDialog.Close
                className={cn(
                  'right-4 top-4 min-h-11 min-w-11 absolute inline-flex items-center justify-center rounded-control border-0 bg-surface text-text',
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
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}

export interface DialogActionsProps {
  children: ReactNode;
  className?: string;
}

export function DialogActions({ children, className }: DialogActionsProps) {
  return <div className={cn('gap-3 mt-7 flex flex-wrap justify-end', className)}>{children}</div>;
}
