/**
 * SessionProvider — STUB for development.
 *
 * Provides a sample session from SAMPLE_SESSIONS keyed by orgRole.
 * In development, honours a `?role=<orgRole>` query parameter so that
 * Playwright and the ThemeStudio role switcher can change the active role.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Session, OrgRole } from '@nestself/contracts';
import { OrgRoleSchema } from '@nestself/contracts';
import { SAMPLE_SESSIONS } from '@nestself/sample-data';

interface SessionContextValue {
  session: Session;
  /** Switch the sample role (development only). */
  setRole: (role: OrgRole) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function resolveInitialRole(): OrgRole {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    const parsed = OrgRoleSchema.safeParse(roleParam);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return 'employee';
}

export interface SessionProviderProps {
  children: ReactNode;
  /** Override the initial role for tests. */
  initialRole?: OrgRole;
}

export function SessionProvider({ children, initialRole }: SessionProviderProps) {
  const [role, setRoleState] = useState<OrgRole>(initialRole ?? resolveInitialRole);

  const session = SAMPLE_SESSIONS[role];

  const setRole = useCallback((newRole: OrgRole) => {
    setRoleState(newRole);
    // Update URL param for bookmarkability
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      const url = new URL(window.location.href);
      url.searchParams.set('role', newRole);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const value = useMemo(() => ({ session, setRole }), [session, setRole]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
