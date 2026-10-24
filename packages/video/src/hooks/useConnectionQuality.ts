import { useMemo } from 'react';
import type { CallSessionControllerApi } from '../types';
import { useControllerSlice } from './useControllerSlice';

/**
 * Three-state connection quality from the 30-second `getStats()` aggregate
 * (UX-38), the degraded-mode flags and whether the call is reconnecting.
 */
export function useConnectionQuality(controller: CallSessionControllerApi) {
  const quality = useControllerSlice(controller, 'quality');
  const { status } = useControllerSlice(controller, 'session');
  const reconnecting = status === 'reconnecting';
  return useMemo(() => ({ ...quality, reconnecting }), [quality, reconnecting]);
}

export type UseConnectionQualityResult = ReturnType<typeof useConnectionQuality>;
