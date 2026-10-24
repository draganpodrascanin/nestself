/**
 * Sample-mode AuthProvider for the admin app.
 * CLIENT-R-30, CLIENT-R-31
 *
 * Defaults to the 'admin' role (unlike the workspace app which defaults
 * to 'employee') because the admin SPA is for platform staff.
 */
import { useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ActiveContext, Principal, AvailableContextEntry } from '@nestself/contracts';
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

interface Props {
  children: ReactNode;
  initialRole?: SampleRole;
}

export { ROLE_ORDER as SAMPLE_ROLE_ORDER, emailToRole };

export function SampleAuthProvider({ children, initialRole }: Props) {
  const [role, setRole] = useState<SampleRole>(
    initialRole ?? resolveInitialRole,
  );
  const baseSample = SAMPLE_PRINCIPALS[role];

  // Context override for sample mode switchContext (ruling 8, T-C1.02).
  const [contextOverride, setContextOverride] = useState<ActiveContext | null>(null);

  const sample = useMemo(() => {
    if (!contextOverride) return baseSample;
    const updatedPrincipal: Principal = { ...baseSample.principal, context: contextOverride };
    return {
      principal: updatedPrincipal,
      effectiveActions: baseSample.effectiveActions,
      availableContexts: baseSample.availableContexts,
    };
  }, [baseSample, contextOverride]);

  const signOut = useCallback(async () => {
    setRole('admin');
    setContextOverride(null);
  }, []);

  const switchContext = useCallback(async (context: ActiveContext) => {
    const available = baseSample.availableContexts;
    const matches = available.some((entry: AvailableContextEntry) => {
      if (entry.kind !== context.kind) return false;
      if (entry.kind === 'personal' && context.kind === 'personal') return entry.orgId === context.orgId;
      if (entry.kind === 'organization' && context.kind === 'organization') return entry.orgId === context.orgId;
      return true;
    });
    if (!matches) throw new Error('Context not available in sample mode');
    setContextOverride(context);
  }, [baseSample.availableContexts]);

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
    setContextOverride(null);
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      const url = new URL(window.location.href);
      url.searchParams.set('role', r);
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const authValue = useMemo(
    () => ({
      status: 'authenticated' as const,
      principal: sample.principal,
      effectiveActions: sample.effectiveActions,
      availableContexts: sample.availableContexts,
      signOut,
      switchContext,
      stepUp,
      refreshPrincipal,
      error: null,
    }),
    [sample, signOut, switchContext, stepUp, refreshPrincipal],
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
