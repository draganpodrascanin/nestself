/**
 * The expert area reads `/professional/*` in the expert context. On mount the
 * session is moved into it once, and only when it is not already there: once
 * the screen has seen the expert context it never switches again, so a choice
 * made in the header context picker is not undone on the same mount.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth';

export interface ExpertContextState {
  /** True once the API may be called (never in sample mode). */
  ready: boolean;
  /** The failed context switch, if any. */
  switchError: unknown;
}

export function useExpertContext(sampleMode: boolean): ExpertContextState {
  const { principal, switchContext } = useAuth();
  const inExpert = principal?.context.kind === 'expert';
  const canSwitch = principal?.expert != null;
  const settled = useRef(false);
  const [switchError, setSwitchError] = useState<unknown>(null);

  useEffect(() => {
    if (inExpert) settled.current = true;
    if (sampleMode || !canSwitch || inExpert || settled.current) return;
    settled.current = true;
    switchContext({ kind: 'expert' }).catch((err: unknown) => {
      setSwitchError(err ?? new Error('context switch failed'));
    });
  }, [sampleMode, canSwitch, inExpert, switchContext]);

  return { ready: !sampleMode && inExpert, switchError: sampleMode ? null : switchError };
}
