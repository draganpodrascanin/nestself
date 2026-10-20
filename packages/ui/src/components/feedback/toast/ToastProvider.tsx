import { X } from '@phosphor-icons/react';
import { Toast as BaseToast } from '@base-ui/react/toast';
import { cn } from '../../../lib/cn';

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
  return (
    <BaseToast.Viewport
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex flex-col gap-2 max-w-[calc(100%-2rem)]"
    >
      {manager.toasts.map((toast) => (
        <BaseToast.Root
          key={toast.id}
          toast={toast}
          className={cn(
            'relative bg-primary text-on-primary shadow-menu rounded-control px-6 py-4 type-body',
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
              'absolute top-2 right-2 inline-flex items-center justify-center min-h-8 min-w-8 rounded-control',
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
  );
}
