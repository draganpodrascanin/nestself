import { Toast as BaseToast } from '@base-ui/react/toast';
import type { ToastData, ToastTone } from './ToastProvider';

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
