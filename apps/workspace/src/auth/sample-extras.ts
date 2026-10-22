/**
 * Separate context for sample-mode-only features (setRole, signInAs).
 *
 * Components like RoleSwitcher that only render in sample mode can import
 * `useSampleAuth()` from here without polluting the main AuthContextValue.
 */
import { createContext, useContext } from 'react';

export interface SampleAuthExtras {
  currentRole: string;
  setRole: (role: string) => void;
  signInAs: (email: string) => void;
}

export const SampleAuthExtrasContext = createContext<SampleAuthExtras | null>(null);

export function useSampleAuth(): SampleAuthExtras {
  const ctx = useContext(SampleAuthExtrasContext);
  if (!ctx) {
    throw new Error('useSampleAuth must be used within SampleAuthProvider');
  }
  return ctx;
}
