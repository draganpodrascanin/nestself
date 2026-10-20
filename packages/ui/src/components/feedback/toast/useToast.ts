import { Toast as BaseToast } from '@base-ui/react/toast';
import type { ToastTone } from './ToastProvider';

export interface ToastData {
  tone?: ToastTone;
}

/**
 * Returns `{ add }` to queue a toast from inside a `<ToastProvider>`.
 */
export function useToast() {
  const manager = BaseToast.useToastManager<ToastData>();
  return {
    add: ({
      title,
      description,
      tone = 'info',
    }: {
      title: string;
      description?: string;
      tone?: ToastTone;
    }) => {
      manager.add({
        title,
        description,
        timeout: 6000,
        priority: tone === 'warning' || tone === 'danger' ? 'high' : 'low',
        data: { tone },
      });
    },
  };
}
