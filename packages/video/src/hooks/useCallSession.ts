import { useMemo } from 'react';
import type { CallJoinResponse } from '@nestself/contracts';
import type { CallSessionControllerOptions } from '../controller';
import type { CallSessionControllerApi, CallSessionStatus } from '../types';
import { useOptionalCallSessionController } from './useCallSessionController';
import { useControllerSlice } from './useControllerSlice';

const IN_CALL: ReadonlySet<CallSessionStatus> = new Set(['joining', 'connected', 'reconnecting']);
const JOINABLE: ReadonlySet<CallSessionStatus> = new Set(['idle', 'failed', 'left']);

export interface UseCallSessionOptions {
  /**
   * Calls `POST /appointments/:id/end` (expert only). When it rejects, the
   * call stays open and the error is rethrown for the screen to render.
   */
  onEndForEveryone?: () => Promise<void> | void;
}

function isControllerApi(source: CallSessionControllerApi | CallSessionControllerOptions): source is CallSessionControllerApi {
  return typeof (source as Partial<CallSessionControllerApi>).getSnapshot === 'function';
}

/**
 * The join state machine for React: status, readiness, media state and the
 * actions that drive them (guidelines 11.2).
 *
 * Pass an existing controller (the caller owns and destroys it), or
 * controller options: the hook then creates the controller once, destroys
 * it on unmount and returns it as `controller` for the components. Do not
 * switch between the two forms while mounted.
 */
export function useCallSession(source: CallSessionControllerApi | CallSessionControllerOptions, options: UseCallSessionOptions = {}) {
  const owned = useOptionalCallSessionController(isControllerApi(source) ? null : source);
  const controller: CallSessionControllerApi = owned ?? (source as CallSessionControllerApi);
  const session = useControllerSlice(controller, 'session');
  const readiness = useControllerSlice(controller, 'readiness');
  const devices = useControllerSlice(controller, 'devices');
  const media = useControllerSlice(controller, 'media');
  const { onEndForEveryone } = options;

  return useMemo(() => {
    const microphoneReady = !devices.canSendAudio || devices.permissions.microphone === 'granted';
    return {
      ...session,
      /** The controller in use: the one passed in, or the one this hook owns. */
      controller,
      readiness,
      media,
      /** The pre-join check finished and the microphone works (CW-R-55a, CALL-03). */
      canJoin: readiness.status === 'done' && microphoneReady && JOINABLE.has(session.status),
      isInCall: IN_CALL.has(session.status),
      checkReadiness: () => controller.checkReadiness(),
      join: (response: CallJoinResponse) => controller.join(response),
      leave: () => controller.leave(),
      endForEveryone: async () => {
        await onEndForEveryone?.();
        await controller.leave();
      },
      toggleMute: () => controller.setMuted(!media.muted),
      toggleCamera: () => controller.setCameraOn(!media.cameraOn),
      toggleScreenShare: () => controller.setScreenShare(!media.sharingScreen),
    };
  }, [controller, session, readiness, devices, media, onEndForEveryone]);
}

export type UseCallSessionResult = ReturnType<typeof useCallSession>;
