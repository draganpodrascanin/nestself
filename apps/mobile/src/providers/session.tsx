import { createContext, useContext, type ReactNode } from 'react';
import { SAMPLE_SESSIONS } from '@nestself/sample-data';

/** Session shape from the contracts package. */
type Session = (typeof SAMPLE_SESSIONS)['employee'];

const SessionContext = createContext<Session | null>(null);

/**
 * Provides a sample employee session for development.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionContext value={SAMPLE_SESSIONS.employee}>
      {children}
    </SessionContext>
  );
}

/**
 * Returns the current session. Throws if used outside SessionProvider.
 */
export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
