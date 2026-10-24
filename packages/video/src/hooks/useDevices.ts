import { useMemo } from 'react';
import type { CallSessionControllerApi, DeviceKind } from '../types';
import { useControllerSlice } from './useControllerSlice';

/** Camera, microphone and speaker lists, selection, permission state and blur (guidelines 11.2). */
export function useDevices(controller: CallSessionControllerApi) {
  const devices = useControllerSlice(controller, 'devices');
  return useMemo(
    () => ({
      ...devices,
      selectDevice: (kind: DeviceKind, deviceId: string) => controller.selectDevice(kind, deviceId),
      setCameraOff: (off: boolean) => controller.setCameraOff(off),
      setBlur: (enabled: boolean) => controller.setBlur(enabled),
      refresh: () => controller.refreshDevices(),
    }),
    [controller, devices],
  );
}

export type UseDevicesResult = ReturnType<typeof useDevices>;
