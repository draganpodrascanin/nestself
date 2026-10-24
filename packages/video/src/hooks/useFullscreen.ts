import { useCallback, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

function subscribe(listener: () => void) {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

/** Fullscreen for the call stage: whether it is on, and a toggle for the control bar. */
export function useFullscreen(target: RefObject<HTMLElement | null>) {
  const isFullscreen = useSyncExternalStore(
    subscribe,
    () => !!document.fullscreenElement && document.fullscreenElement === target.current,
    () => false,
  );
  const toggle = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen?.();
    else await target.current?.requestFullscreen?.();
  }, [target]);
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  return { isFullscreen, toggle, supported };
}
