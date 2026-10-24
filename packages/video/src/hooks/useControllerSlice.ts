import { useCallback, useSyncExternalStore } from 'react';
import type { CallSessionControllerApi, CallSessionSnapshot } from '../types';

/**
 * Subscribes to one slice of the controller snapshot. Slices keep their
 * identity until they change, so components re-render only for their slice.
 */
export function useControllerSlice<K extends keyof CallSessionSnapshot>(
  controller: CallSessionControllerApi,
  key: K,
): CallSessionSnapshot[K] {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const read = () => controller.getSnapshot()[key];
  return useSyncExternalStore(subscribe, read, read);
}
