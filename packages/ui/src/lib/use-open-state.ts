import { useCallback, useState } from 'react';

export interface OpenStateOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Controlled-or-uncontrolled open state. Animated popups need to know when
 * they open and close (so `<AnimatePresence>` can keep them mounted for the
 * exit), which means the wrapper always passes `open` to Base UI.
 */
export function useOpenState({ open, defaultOpen = false, onOpenChange }: OpenStateOptions) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const controlled = open !== undefined;
  const current = controlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  return [current, setOpen] as const;
}
