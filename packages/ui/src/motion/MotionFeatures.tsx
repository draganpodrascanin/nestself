'use client';

import { LazyMotion, domAnimation } from 'motion/react';
import type { ReactNode } from 'react';

export interface MotionFeaturesProps {
  children: ReactNode;
}

/**
 * Loads Motion's animation features (animate, exit, variants, gestures) for
 * the `m.*` elements below it. Components wrap their own animated parts, so
 * apps need no provider and a page only ships the features it renders.
 * Features register globally, so nesting is harmless. Components that
 * animate `layout` use `MotionLayoutFeatures` instead.
 */
export function MotionFeatures({ children }: MotionFeaturesProps) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}
