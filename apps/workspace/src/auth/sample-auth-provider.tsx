/**
 * Sample-mode AuthProvider -- uses SAMPLE_PRINCIPALS keyed by the legacy
 * role selected via `?role=` (dev only).
 *
 * CLIENT-R-30: same `useAuth()` shape as the real provider.
 * CLIENT-R-31: never reaches production builds (guarded by `isSampleDataMode`).
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
  return map[prefix ?? ''] ?? 'employee';
}

function resolveInitialRole(): SampleRole {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    if (roleParam && roleParam in SAMPLE_PRINCIPALS) {
      return roleParam as SampleRole;
    }
  }
  return 'employee';
}

interface Props {
  children: ReactNode;
  initialRole?: SampleRole;
}

export { ROLE_ORDER as SAMPLE_ROLE_ORDER, emailToRole };

export function SampleAuthProvider({ children, initialRole }: Props) {
  const [role, setRoleState] = useState<SampleRole>(initialRole ?? resolveInitialRole);
  const baseSample = SAMPLE_PRINCIPALS[role];

  // Sample mode context override: switchContext updates the principal's context
  // and the visible available contexts, staying within the current role's data.
  const [contextOverride, setContextOverride] = useState<ActiveContext | null>(null);

  // When role changes, clear the context override.
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
    setRoleState('employee');
    setContextOverride(null);
  }, []);

  const switchContext = useCallback(async (context: ActiveContext) => {
    // In sample mode, apply the context to the current role's principal.
    // Validate that the target context is in the available list.
    const available = baseSample.availableContexts;
    const matches = available.some((entry: AvailableContextEntry) => {
      if (entry.kind !== context.kind) return false;
      if (entry.kind === 'personal' && context.kind === 'personal') return entry.orgId === context.orgId;
      if (entry.kind === 'organization' && context.kind === 'organization') return entry.orgId === context.orgId;
      return true;
    });
    if (!matches) {
      throw new Error('Context not available in sample mode');
    }
    setContextOverride(context);
  }, [baseSample.availableContexts]);

  const stepUp = useCallback(() => {
    // No-op in sample mode.
  }, []);

  const refreshPrincipal = useCallback(async () => {
    // No-op in sample mode.
  }, []);

  const signInAs = useCallback((email: string) => {
    setRoleState(emailToRole(email));
  }, []);

  const setRole = useCallback((newRole: string) => {
    if (newRole in SAMPLE_PRINCIPALS) {
      setRoleState(newRole as SampleRole);
      setContextOverride(null);
      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        const url = new URL(window.location.href);
        url.searchParams.set('role', newRole);
        window.history.replaceState(null, '', url.toString());
      }
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

  const extrasValue = useMemo(
    () => ({ currentRole: role, setRole, signInAs }),
    [role, setRole, signInAs],
  );

  return (
    <AuthContext value={authValue}>
      <SampleAuthExtrasContext value={extrasValue}>
        {children}
      </SampleAuthExtrasContext>
    </AuthContext>
  );
}
