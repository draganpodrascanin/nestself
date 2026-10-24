import { useMemo } from 'react';
import type { CallJoinResponse } from '@nestself/contracts';
import type { CallSessionControllerApi, CallSessionStatus } from '../types';
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

/**
 * The join state machine for React: status, readiness, media state and the
 * actions that drive them (guidelines 11.2).
 */
export function useCallSession(controller: CallSessionControllerApi, options: UseCallSessionOptions = {}) {
  const session = useControllerSlice(controller, 'session');
  const readiness = useControllerSlice(controller, 'readiness');
  const devices = useControllerSlice(controller, 'devices');
  const media = useControllerSlice(controller, 'media');
  const { onEndForEveryone } = options;

  return useMemo(() => {
    const microphoneReady = !devices.canSendAudio || devices.permissions.microphone === 'granted';
    return {
      ...session,
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
