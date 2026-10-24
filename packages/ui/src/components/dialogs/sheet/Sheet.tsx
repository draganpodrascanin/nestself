'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from '@phosphor-icons/react/dist/ssr';
import { Children, createContext, isValidElement, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import { useOpenState } from '../../../lib/use-open-state';
import { AnimatePresence, m, MotionFeatures, useMotionPreset } from '../../../motion';

/** Lets `SheetContent` see the open state so the exit animation can play before unmount. */
const SheetOpenContext = createContext(false);

export interface SheetProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

export function Sheet({ children, open, onOpenChange, defaultOpen }: SheetProps) {
  const [isOpen, setOpen] = useOpenState({ open, defaultOpen, onOpenChange });
  return (
    <BaseDialog.Root open={isOpen} onOpenChange={setOpen}>
      <SheetOpenContext.Provider value={isOpen}>{children}</SheetOpenContext.Provider>
    </BaseDialog.Root>
  );
}

export interface SheetTriggerProps {
  children: ReactNode;
  className?: string;
}

/**
 * When `children` is a single React element (e.g. `<Button>`), the element
 * itself becomes the trigger via Base UI's `render` prop, avoiding a nested
 * `<button>`.  When `children` is text or a fragment, the trigger wraps it
 * as before.
 */
export function SheetTrigger({ children, className }: SheetTriggerProps) {
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

export type SheetSide = 'bottom' | 'left' | 'right';

export interface SheetContentProps {
  children: ReactNode;
  title: string;
  description?: string;
  closeLabel?: string;
  /** Edge the sheet slides in from: `bottom` (sheet) or `left` / `right` (drawer). */
  side?: SheetSide;
  className?: string;
}

const sideClasses: Record<SheetSide, string> = {
  bottom:
    'bottom-0 left-0 right-0 max-h-[min(85vh,52rem)] rounded-t-sheet pb-[max(1.5rem,env(safe-area-inset-bottom))]',
  left: 'inset-y-0 left-0 w-[min(calc(100%-3rem),24rem)] rounded-r-sheet pb-[max(1.5rem,env(safe-area-inset-bottom))]',
  right:
    'inset-y-0 right-0 w-[min(calc(100%-3rem),24rem)] rounded-l-sheet pb-[max(1.5rem,env(safe-area-inset-bottom))]',
};

export function SheetContent({
  children,
  title,
  description,
  closeLabel = 'Close',
  side = 'bottom',
  className,
}: SheetContentProps) {
  const open = useContext(SheetOpenContext);
  const backdropMotion = useMotionPreset('backdrop');
  const popupMotion = useMotionPreset(`sheet-${side}`);
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
              data-side={side}
              render={<m.div {...popupMotion} />}
              className={cn(
                'p-6 fixed z-[var(--z-dialog)] overflow-auto bg-surface shadow-modal',
                sideClasses[side],
                className,
              )}
            >
              <BaseDialog.Title className="pr-8 mb-4 type-section-title">{title}</BaseDialog.Title>
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
