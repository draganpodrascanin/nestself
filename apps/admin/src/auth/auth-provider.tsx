/**
 * Real-mode AuthProvider -- uses cookie-based auth with the API.
 * CLIENT-R-01..04, CLIENT-R-28
 */
import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Principal, ActiveContext } from '@nestself/contracts';
import { createAuthApi, ApiError } from '@nestself/api-client';
import type { ApiClient } from '@nestself/api-client';
import { AuthContext } from './auth-context';
import type { AuthStatus } from './types';

interface Props {
  client: ApiClient;
  children: ReactNode;
  onUnauthenticated?: () => void;
}

export function AuthProvider({ client, children, onUnauthenticated }: Props) {
  const queryClient = useQueryClient();
  const authApi = useMemo(() => createAuthApi(client), [client]);

  const [status, setStatus] = useState<AuthStatus>('loading');
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [effectiveActions, setEffectiveActions] = useState<readonly string[]>(
    [],
  );
  const [error, setError] = useState<Error | null>(null);

  const applyMe = useCallback(
    (data: { principal: Principal; effectiveActions: string[] }) => {
      setPrincipal(data.principal);
      setEffectiveActions(data.effectiveActions);
      setStatus('authenticated');
      setError(null);
    },
    [],
  );

  const refreshPrincipal = useCallback(async () => {
    try {
      const data = await authApi.me();
      applyMe(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPrincipal(null);
        setEffectiveActions([]);
        setStatus('unauthenticated');
        setError(null);
      } else {
        // Keep previous state, expose error
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [authApi, applyMe]);

  // Initial fetch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: setState runs after await, not synchronously
    void refreshPrincipal();
  }, [refreshPrincipal]);

  // Refetch on window focus
  useEffect(() => {
    const handleFocus = () => {
      void refreshPrincipal();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshPrincipal]);

  const signOut = useCallback(async () => {
    try {
      await authApi.signOut();
    } catch {
      // Best-effort: clear local state even if request fails
    }
    setPrincipal(null);
    setEffectiveActions([]);
    setStatus('unauthenticated');
    queryClient.cancelQueries();
    queryClient.clear();
    onUnauthenticated?.();
  }, [authApi, queryClient, onUnauthenticated]);

  const switchContext = useCallback(
    async (context: ActiveContext) => {
      const data = await authApi.switchContext(context);
      applyMe(data);
    },
    [authApi, applyMe],
  );

  const stepUp = useCallback(() => {
    // Phase 2: show step-up dialog. For now a placeholder.
  }, []);

  const value = useMemo(
    () => ({
      status,
      principal,
      effectiveActions,
      signOut,
      switchContext,
      stepUp,
      refreshPrincipal,
      error,
    }),
    [
      status,
      principal,
      effectiveActions,
      signOut,
      switchContext,
      stepUp,
      refreshPrincipal,
      error,
    ],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
