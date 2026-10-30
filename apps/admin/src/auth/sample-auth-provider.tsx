/**
 * Sample-mode AuthProvider for the admin app.
 * CLIENT-R-30, CLIENT-R-31
 *
 * Defaults to the 'admin' role (unlike the workspace app which defaults
 * to 'employee') because the admin SPA is for platform staff.
 */
import { useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ActiveContext, Principal } from '@nestself/contracts';
import { ApiError } from '@nestself/api-client';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { AuthContext } from './auth-context';
import { SampleAuthExtrasContext } from './sample-extras';

type SampleRole = keyof typeof SAMPLE_PRINCIPALS;

const ROLE_ORDER: SampleRole[] = [
  'employee',
  'manager',
  'hr_admin',
  'expert',
  'operations',
  'admin',
];

/** Map sample email prefixes to roles. */
function emailToRole(email: string): SampleRole {
  const prefix = email.split('@')[0]?.toLowerCase();
  const map: Record<string, SampleRole> = {
    user_jovan: 'employee',
    user_ana: 'employee',
    user_stefan: 'manager',
    user_ivana: 'hr_admin',
    user_milica: 'expert',
    user_nikola: 'operations',
    user_admin: 'admin',
    admin: 'admin',
  };
  return map[prefix ?? ''] ?? 'admin';
}

function resolveInitialRole(): SampleRole {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    if (roleParam && roleParam in SAMPLE_PRINCIPALS) {
      return roleParam as SampleRole;
    }
  }
  return 'admin';
}

/** The API's rule for `POST /auth/context` (session-endpoints.service.ts). */
function sampleContextAllowed(principal: Principal, context: ActiveContext): boolean {
  switch (context.kind) {
    case 'personal':
      return true;
    case 'organization':
      return principal.memberships.some((m) => m.orgId === context.orgId && m.status === 'ACTIVE');
    case 'expert':
      return principal.expert !== null;
    case 'operations':
      return principal.staffTemplates.length > 0;
  }
}

interface Props {
  children: ReactNode;
  initialRole?: SampleRole;
}

export { ROLE_ORDER as SAMPLE_ROLE_ORDER, emailToRole };

export function SampleAuthProvider({ children, initialRole }: Props) {
  const [role, setRole] = useState<SampleRole>(
    initialRole ?? resolveInitialRole,
  );
  const sample = SAMPLE_PRINCIPALS[role];

  const signOut = useCallback(async () => {
    setRole('admin');
  }, []);

  // Context switching is local: the label and `principal.context` change,
  // the precomputed sample actions do not. Contexts the sample principal
  // could not hold are refused the way the API refuses them.
  const [switched, setSwitched] = useState<{ role: SampleRole; context: ActiveContext } | null>(null);
  const switchContext = useCallback(
    async (context: ActiveContext) => {
      if (!sampleContextAllowed(sample.principal, context)) {
        throw new ApiError({
          status: 403,
          code: 'invalid_context',
          message: 'The requested context is not available to this user',
          requestId: null,
        });
      }
      setSwitched({ role, context });
    },
    [sample, role],
  );
  const principal = useMemo<Principal>(
    () => (switched && switched.role === role ? { ...sample.principal, context: switched.context } : sample.principal),
    [sample, switched, role],
  );

  const stepUp = useCallback(async () => {
    // Sample mode has no session to re-authenticate; treat it as verified.
    return true;
  }, []);

  const refreshPrincipal = useCallback(async () => {
    // No-op in sample mode
  }, []);

  const signInAs = useCallback((email: string) => {
    setRole(emailToRole(email));
  }, []);

  const setRoleDirectly = useCallback((newRole: string) => {
    const r = newRole as SampleRole;
    setRole(r);
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      const url = new URL(window.location.href);
      url.searchParams.set('role', r);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const authValue = useMemo(
    () => ({
      status: 'authenticated' as const,
      principal,
      effectiveActions: sample.effectiveActions,
      signOut,
      switchContext,
      stepUp,
      refreshPrincipal,
      error: null,
    }),
    [principal, sample, signOut, switchContext, stepUp, refreshPrincipal],
  );

  const extras = useMemo(
    () => ({
      currentRole: role,
      setRole: setRoleDirectly,
      signInAs,
    }),
    [role, setRoleDirectly, signInAs],
  );

  return (
    <AuthContext value={authValue}>
      <SampleAuthExtrasContext value={extras}>
        {children}
      </SampleAuthExtrasContext>
    </AuthContext>
  );
}
