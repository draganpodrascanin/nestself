'use client';

import { LazyMotion, domMax } from 'motion/react';
import type { ReactNode } from 'react';

export interface MotionLayoutFeaturesProps {
  children: ReactNode;
}

/**
 * `MotionFeatures` plus layout animations (`layout`, `layoutId`). Lives in
 * its own module so the larger feature bundle only reaches the apps that
 * render a component using it (today: the toast stack).
 */
export function MotionLayoutFeatures({ children }: MotionLayoutFeaturesProps) {
  return <LazyMotion features={domMax}>{children}</LazyMotion>;
}
