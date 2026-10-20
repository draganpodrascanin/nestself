/**
 * Session stub for the admin app.
 * In development, the `?role=<platformRole>` search param switches
 * the active session (default: "admin"). This is a stub -- all data
 * comes from @nestself/sample-data.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, PlatformRole } from '@nestself/contracts';
import { PlatformRoleSchema } from '@nestself/contracts';
import { SAMPLE_SESSIONS } from '@nestself/sample-data';

interface SessionContextValue {
  session: Session;
  /** Switch the sample platform role (development only). */
  setRole: (role: PlatformRole) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function resolveInitialRole(): PlatformRole {
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    if (roleParam) {
      const parsed = PlatformRoleSchema.safeParse(roleParam);
      if (parsed.success) return parsed.data;
    }
  }
  return 'admin';
}

export interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [role, setRoleState] = useState<PlatformRole>(resolveInitialRole);

  const session = SAMPLE_SESSIONS[role];

  const setRole = useCallback((newRole: PlatformRole) => {
    setRoleState(newRole);
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      const url = new URL(window.location.href);
      url.searchParams.set('role', newRole);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const value = useMemo(() => ({ session, setRole }), [session, setRole]);

  return (
    <SessionContext value={value}>
      {children}
    </SessionContext>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
