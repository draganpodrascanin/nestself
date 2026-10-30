import type { ReactNode } from 'react';
import { AnimatePresence, MotionFeatures, cn, m, useMotionPreset } from '@nestself/ui';

/**
 * An inline notice or panel that appears and disappears with the popover
 * preset (Motion rule): mounted content animates out before it unmounts.
 */
export function Reveal({
  show,
  children,
  className,
  appear = false,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
  /** Animate in on first mount too (a notice that replaces other content). */
  appear?: boolean;
}) {
  const preset = useMotionPreset('popover');
  return (
    <MotionFeatures>
      <AnimatePresence initial={appear}>
        {show ? (
          <m.div key="reveal" {...preset} className={cn('origin-top', className)}>
            {children}
          </m.div>
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}
