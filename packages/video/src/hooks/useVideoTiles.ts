import { useMemo } from 'react';
import type { CallSessionControllerApi } from '../types';
import { useControllerSlice } from './useControllerSlice';

/**
 * Tile ids for the local camera, the remote camera(s) and shared content.
 * `primaryTileId` is what speaker view shows large: shared content first,
 * then the first remote camera.
 */
export function useVideoTiles(controller: CallSessionControllerApi) {
  const tiles = useControllerSlice(controller, 'tiles');
  return useMemo(
    () => ({
      localTileId: tiles.localTileId,
      contentTileId: tiles.contentTileId,
      remoteTiles: tiles.remote,
      remoteTileIds: tiles.remote.map((tile) => tile.tileId),
      primaryTileId: tiles.contentTileId ?? tiles.remote[0]?.tileId ?? null,
      bind: (tileId: number, element: HTMLVideoElement) => controller.bindVideoTile(tileId, element),
      unbind: (tileId: number) => controller.unbindVideoTile(tileId),
    }),
    [controller, tiles],
  );
}

export type UseVideoTilesResult = ReturnType<typeof useVideoTiles>;
