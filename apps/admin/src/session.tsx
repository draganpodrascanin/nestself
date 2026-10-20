/**
 * Session stub for the admin app.
 * In development, the `?role=<platformRole>` search param switches
 * the active session (default: "admin"). This is a stub -- all data
 * comes from @nestself/sample-data.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Session, PlatformRole } from '@nestself/contracts';
import { PlatformRoleSchema } from '@nestself/contracts';
import { SAMPLE_SESSIONS } from '@nestself/sample-data';

interface SessionContextValue {
  session: Session;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function resolveRole(): PlatformRole {
  if (import.meta.env.DEV) {
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
  const role = resolveRole();
  const session = useMemo(() => SAMPLE_SESSIONS[role], [role]);

  return (
    <SessionContext value={{ session }}>
      {children}
    </SessionContext>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
