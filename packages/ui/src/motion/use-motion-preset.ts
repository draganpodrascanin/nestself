'use client';

import { useReducedMotion } from 'motion/react';
import { motionPresets, reducedMotionPresets } from './presets';
import type { MotionPreset, MotionPresetName } from './presets';

/**
 * Returns the named preset, or its reduced-motion variant when the person
 * has asked the operating system to reduce motion. Spread the result onto
 * an `m.*` element: `<m.div {...useMotionPreset('dialog')} />`.
 */
export function useMotionPreset(name: MotionPresetName): MotionPreset {
  const reduce = useReducedMotion();
  return reduce ? reducedMotionPresets[name] : motionPresets[name];
}
