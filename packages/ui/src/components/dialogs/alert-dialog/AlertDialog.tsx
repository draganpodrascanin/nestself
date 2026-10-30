'use client';

import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { Children, createContext, isValidElement, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import { POPUP_LAYER_ABOVE_DIALOG } from '../../../lib/layers';
import { useOpenState } from '../../../lib/use-open-state';
import { AnimatePresence, m, MotionFeatures, useMotionPreset } from '../../../motion';

/** Lets `AlertDialogContent` see the open state so the exit animation can play before unmount. */
const AlertDialogOpenContext = createContext(false);

export interface AlertDialogProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

export function AlertDialog({ children, open, onOpenChange, defaultOpen }: AlertDialogProps) {
  const [isOpen, setOpen] = useOpenState({ open, defaultOpen, onOpenChange });
  return (
    <BaseAlertDialog.Root open={isOpen} onOpenChange={setOpen}>
      <AlertDialogOpenContext.Provider value={isOpen}>{children}</AlertDialogOpenContext.Provider>
    </BaseAlertDialog.Root>
  );
}

export interface AlertDialogTriggerProps {
  children: ReactNode;
  className?: string;
}

/**
 * When `children` is a single React element (e.g. `<Button>`), the element
 * itself becomes the trigger via Base UI's `render` prop, avoiding a nested
 * `<button>`.  When `children` is text or a fragment, the trigger wraps it
 * as before.
 */
export function AlertDialogTrigger({ children, className }: AlertDialogTriggerProps) {
  if (isSingleElement(children)) {
    return (
      <BaseAlertDialog.Trigger render={children as ReactElement} className={className} />
    );
  }
  return <BaseAlertDialog.Trigger className={className}>{children}</BaseAlertDialog.Trigger>;
}

function isSingleElement(children: ReactNode): boolean {
  try {
    const child = Children.only(children);
    return isValidElement(child);
  } catch {
    return false;
  }
}

export interface AlertDialogContentProps {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm?: () => void;
  /** The confirmed action is running: the confirm button is disabled and marked busy. */
  confirmPending?: boolean;
  children?: ReactNode;
  className?: string;
}

export function AlertDialogContent({
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  confirmPending = false,
  children,
  className,
}: AlertDialogContentProps) {
  const open = useContext(AlertDialogOpenContext);
  const backdropMotion = useMotionPreset('backdrop');
  const popupMotion = useMotionPreset('dialog');
  return (
    <MotionFeatures>
      <AnimatePresence>
        {open ? (
          <BaseAlertDialog.Portal keepMounted className={POPUP_LAYER_ABOVE_DIALOG}>
            <BaseAlertDialog.Backdrop
              className="fixed inset-0 bg-scrim z-[var(--z-scrim)]"
              render={<m.div {...backdropMotion} />}
            />
            <BaseAlertDialog.Popup
              aria-modal="true"
              render={<m.div {...popupMotion} />}
              className={cn(
                'fixed inset-0 m-auto h-fit w-[min(calc(100%-2rem),37rem)] max-h-[min(85vh,52rem)] overflow-auto',
                'rounded-modal border border-border-subtle bg-surface p-8 pointer-coarse:p-6 shadow-modal z-[var(--z-dialog)]',
                className,
              )}
            >
              <BaseAlertDialog.Title className="type-section-title mb-5">
                {title}
              </BaseAlertDialog.Title>
              {description ? (
                <BaseAlertDialog.Description className="text-text-secondary mb-4">
                  {description}
                </BaseAlertDialog.Description>
              ) : null}
              {children}
              <div className="flex flex-wrap justify-end gap-3 mt-7">
                <BaseAlertDialog.Close
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-control border font-[var(--font-weight-label)] leading-normal min-h-11 px-5 py-2.5',
                    'border-border-control bg-surface text-primary hover:bg-tint',
                    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                    'pointer-coarse:min-h-12',
                  )}
                >
                  {cancelLabel}
                </BaseAlertDialog.Close>
                <BaseAlertDialog.Close
                  onClick={onConfirm}
                  disabled={confirmPending}
                  aria-busy={confirmPending || undefined}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-control border border-transparent font-[var(--font-weight-label)] leading-normal min-h-11 px-5 py-2.5',
                    destructive
                      ? 'btn-danger bg-danger text-surface hover:brightness-95'
                      : 'bg-primary text-on-primary hover:bg-primary-hover',
                    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    'pointer-coarse:min-h-12',
                  )}
                >
                  {confirmLabel}
                </BaseAlertDialog.Close>
              </div>
            </BaseAlertDialog.Popup>
          </BaseAlertDialog.Portal>
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}
