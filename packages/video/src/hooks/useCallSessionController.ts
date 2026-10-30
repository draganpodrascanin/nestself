import { useEffect, useRef, useState } from 'react';
import { CallSessionController } from '../controller';
import type { CallSessionControllerOptions } from '../controller';

/**
 * Destroys the controller when the component that owns it unmounts. The
 * destroy waits one tick and is cancelled if the effect runs again, so a
 * React StrictMode replay (unmount, mount) keeps the same live controller.
 */
function useDestroyOnUnmount(controller: CallSessionController | null): void {
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!controller) return undefined;
    if (pending.current) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    return () => {
      pending.current = setTimeout(() => {
        pending.current = null;
        void controller.destroy();
      }, 0);
    };
  }, [controller]);
}

/**
 * Creates one `CallSessionController` for the lifetime of the component and
 * destroys it on unmount (guidelines 11.2): the camera and microphone are
 * released and the meeting is left. Options are read once, on first render.
 */
export function useCallSessionController(options: CallSessionControllerOptions): CallSessionController {
  const [controller] = useState(() => new CallSessionController(options));
  useDestroyOnUnmount(controller);
  return controller;
}

/** Owns a controller only when options are given; `null` means the caller owns one. */
export function useOptionalCallSessionController(options: CallSessionControllerOptions | null): CallSessionController | null {
  const [controller] = useState(() => (options ? new CallSessionController(options) : null));
  useDestroyOnUnmount(controller);
  return controller;
}
