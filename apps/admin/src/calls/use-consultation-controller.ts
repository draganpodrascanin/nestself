/**
 * The call controller for a consultation screen. API mode: the Chime-backed
 * controller from `@nestself/video` (`useCallSessionController`), created
 * once and destroyed on unmount, so leaving the route without joining turns
 * the camera preview off. Sample mode: a `FakeCallSessionController` with the
 * same lifecycle; it never loads the Chime SDK and never joins a meeting.
 */
import { useEffect, useRef, useState } from 'react';
import { FakeCallSessionController, useCallSessionController } from '@nestself/video';
import type { CallSessionControllerApi, CallSessionControllerOptions } from '@nestself/video';
import { isSampleDataMode } from '../data-source';

/** Same StrictMode-safe destroy as `useCallSessionController`. */
function useSampleController(options: CallSessionControllerOptions): CallSessionControllerApi {
  const [controller] = useState(() => new FakeCallSessionController({ role: options.role, format: options.format }));
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
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
  return controller;
}

export const useConsultationController: (options: CallSessionControllerOptions) => CallSessionControllerApi = isSampleDataMode
  ? useSampleController
  : useCallSessionController;
