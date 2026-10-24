'use client';

import { LazyMotion, domAnimation, domMax } from 'motion/react';
import type { ReactNode } from 'react';

export interface MotionFeaturesProps {
  children: ReactNode;
  /**
   * Load layout animations as well (`layout`, `layoutId`). Costs about
   * 10 kB more, so only components that reflow siblings ask for it.
   */
  layout?: boolean;
}

/**
 * Loads Motion's animation features for the `m.*` elements below it.
 * Components wrap their own animated parts, so apps need no provider and a
 * marketing page only ships the features it renders. Features register
 * globally, so nesting is harmless.
 */
export function MotionFeatures({ children, layout = false }: MotionFeaturesProps) {
  return <LazyMotion features={layout ? domMax : domAnimation}>{children}</LazyMotion>;
}
