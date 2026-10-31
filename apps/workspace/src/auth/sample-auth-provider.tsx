/**
 * Sample-mode AuthProvider -- uses SAMPLE_PRINCIPALS keyed by the legacy
 * role selected via `?role=` (dev only).
 *
 * CLIENT-R-30: same `useAuth()` shape as the real provider.
 * CLIENT-R-31: never reaches production builds (guarded by `isSampleDataMode`).
 */
import { useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ActiveContext, Principal } from '@nestself/contracts';
import { ApiError } from '@nestself/api-client';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { AuthContext } from './auth-context';
import { SampleAuthExtrasContext } from './sample-extras';
import type { AuthSnapshot } from './types';

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

/**
 * The session route guards see in sample mode before the provider has synced
 * the router context: the principal of the `?role=` sample (else employee).
 * Without it a deep link such as `/hr?role=hr_admin` was decided on a null
 * principal and redirected away.
 */
export function sampleRouteSnapshot(): AuthSnapshot {
  const sample = SAMPLE_PRINCIPALS[resolveInitialRole()];
  return { principal: sample.principal, effectiveActions: sample.effectiveActions, availableContexts: sample.availableContexts };
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

  // Context switching is local: the label and `principal.context` change,
  // the precomputed sample actions do not. Contexts the sample principal
  // could not hold are refused the way the API refuses them.
  const switchContext = useCallback(
    async (context: ActiveContext) => {
      if (!sampleContextAllowed(baseSample.principal, context)) {
        throw new ApiError({
          status: 403,
          code: 'invalid_context',
          message: 'The requested context is not available to this user',
          requestId: null,
        });
      }
      setContextOverride(context);
    },
    [baseSample],
  );

  const stepUp = useCallback(async () => {
    // Sample mode has no session to re-authenticate; treat it as verified.
    return true;
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
