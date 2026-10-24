import { useCallback, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

function subscribe(listener: () => void) {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

/**
 * Fullscreen for a call. The whole document goes fullscreen, not the stage:
 * menus, sheets and dialogs portal to `document.body`, which a fullscreen
 * stage element would hide (the crisis sheet among them). Pass `isFullscreen`
 * to `CallStage`'s `fullscreen` prop so the stage pins itself to the viewport.
 *
 * @param _stage kept for compatibility; the stage is no longer the fullscreen element.
 */
export function useFullscreen(_stage?: RefObject<HTMLElement | null>) {
  const isFullscreen = useSyncExternalStore(
    subscribe,
    () => !!document.fullscreenElement && document.fullscreenElement === document.documentElement,
    () => false,
  );
  const toggle = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen?.();
    else await document.documentElement.requestFullscreen?.();
  }, []);
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  return { isFullscreen, toggle, supported };
}
