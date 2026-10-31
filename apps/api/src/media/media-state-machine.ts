/**
 * Media asset state machine (MED-R-14, 8.5).
 *
 * Pure function: validates and returns the new state, or throws.
 *
 * The `uploaded → processing` transition is used by the atomic claim in
 * MediaService.processAsset() (UPDATE ... WHERE state = 'uploaded').
 */
import type { MediaAssetState } from '@nestself/contracts';

const TRANSITIONS: ReadonlyMap<MediaAssetState, ReadonlySet<MediaAssetState>> = new Map([
  ['uploaded', new Set<MediaAssetState>(['quarantined', 'processing', 'rejected'])],
  ['quarantined', new Set<MediaAssetState>(['processing', 'rejected'])],
  ['processing', new Set<MediaAssetState>(['ready', 'rejected'])],
  ['ready', new Set<MediaAssetState>(['expired'])],
  // rejected and expired are terminal
  ['rejected', new Set<MediaAssetState>()],
  ['expired', new Set<MediaAssetState>()],
]);

export function assertTransition(
  from: MediaAssetState,
  to: MediaAssetState,
): void {
  const allowed = TRANSITIONS.get(from);
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Invalid media state transition: ${from} -> ${to}`);
  }
}

export function canTransition(
  from: MediaAssetState,
  to: MediaAssetState,
): boolean {
  const allowed = TRANSITIONS.get(from);
  return !!allowed && allowed.has(to);
}
