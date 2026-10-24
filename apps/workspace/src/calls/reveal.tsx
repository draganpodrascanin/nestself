import type { ReactNode } from 'react';
import { AnimatePresence, MotionFeatures, cn, m, useMotionPreset } from '@nestself/ui';

/**
 * An inline notice or panel that appears and disappears with the popover
 * preset (Motion rule): mounted content animates out before it unmounts.
 */
export function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  const preset = useMotionPreset('popover');
  return (
    <MotionFeatures>
      <AnimatePresence initial={false}>
        {show ? (
          <m.div key="reveal" {...preset} className={cn('origin-top', className)}>
            {children}
          </m.div>
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}
