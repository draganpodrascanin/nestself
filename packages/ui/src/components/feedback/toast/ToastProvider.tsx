'use client';

import { X } from '@phosphor-icons/react/dist/ssr';
import { Toast as BaseToast } from '@base-ui/react/toast';
import type { HTMLMotionProps } from 'motion/react';
import { useReducedMotion } from 'motion/react';
import { cn } from '../../../lib/cn';
import { m, useMotionPreset } from '../../../motion';
import { MotionLayoutFeatures } from '../../../motion/MotionLayoutFeatures';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastData {
  tone?: ToastTone;
}

export interface ToastProviderProps {
  children: React.ReactNode;
  labels: { dismiss: string };
}

export function ToastProvider({ children, labels }: ToastProviderProps) {
  return (
    <BaseToast.Provider>
      {children}
      <ToastViewport dismissLabel={labels.dismiss} />
    </BaseToast.Provider>
  );
}

function ToastViewport({ dismissLabel }: { dismissLabel: string }) {
  const manager = BaseToast.useToastManager<ToastData>();
  const toastMotion = useMotionPreset('toast');
  const reduceMotion = useReducedMotion();
  return (
    <MotionLayoutFeatures>
      <BaseToast.Viewport className="bottom-6 gap-2 fixed left-1/2 z-[var(--z-toast)] flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col">
        {manager.toasts.map((toast) => (
          <BaseToast.Root
            key={toast.id}
            toast={toast}
            /*
             * Base UI marks a closing toast `ending` and removes it once the
             * exit animation on this element finishes; `layout` lets the
             * remaining toasts glide into the freed space.
             */
            render={(props, state) => (
              <m.div
                {...(props as HTMLMotionProps<'div'>)}
                layout={reduceMotion ? false : 'position'}
                initial={toastMotion.initial}
                animate={state.transitionStatus === 'ending' ? toastMotion.exit : toastMotion.animate}
              />
            )}
            className={cn(
              // pr-12 keeps the text clear of the absolutely placed close button.
              'pl-6 pr-12 py-4 relative rounded-control bg-primary type-body text-on-primary shadow-menu',
            )}
          >
            <BaseToast.Title className="font-[var(--font-weight-label)]">
              {toast.title}
            </BaseToast.Title>
            {toast.description ? (
              <BaseToast.Description className="mt-1 opacity-90">
                {toast.description}
              </BaseToast.Description>
            ) : null}
            <BaseToast.Close
              className={cn(
                'top-2 right-2 min-h-8 min-w-8 absolute inline-flex items-center justify-center rounded-control',
                'text-on-primary opacity-70 hover:opacity-100',
                'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
              )}
              aria-label={dismissLabel}
            >
              <X size={16} aria-hidden />
            </BaseToast.Close>
          </BaseToast.Root>
        ))}
      </BaseToast.Viewport>
    </MotionLayoutFeatures>
  );
}
