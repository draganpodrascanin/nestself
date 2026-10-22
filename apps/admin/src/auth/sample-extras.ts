import { createContext, useContext } from 'react';

export interface SampleAuthExtras {
  currentRole: string;
  setRole: (role: string) => void;
  signInAs: (email: string) => void;
}

export const SampleAuthExtrasContext =
  createContext<SampleAuthExtras | null>(null);

export function useSampleAuth(): SampleAuthExtras {
  const ctx = useContext(SampleAuthExtrasContext);
  if (!ctx) {
    throw new Error('useSampleAuth must be used within SampleAuthProvider');
  }
  return ctx;
}
