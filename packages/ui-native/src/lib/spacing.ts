import { nativeSpace, nativeRadius } from '@nestself/tokens/native';

export type SpaceKey = keyof typeof nativeSpace;
export type RadiusKey = keyof typeof nativeRadius;

/**
 * Returns the numeric space value for a given space token key.
 */
export function space(key: SpaceKey): number {
  return nativeSpace[key];
}

/**
 * Returns the numeric radius value for a given radius token key.
 */
export function radius(key: RadiusKey): number {
  return nativeRadius[key];
}
