import { useCallback, useSyncExternalStore } from 'react';

/** True while the media query matches; false outside a browser. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener?.('change', listener);
      return () => list.removeEventListener?.('change', listener);
    },
    [query],
  );
  const read = () => (typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  return useSyncExternalStore(subscribe, read, () => false);
}
