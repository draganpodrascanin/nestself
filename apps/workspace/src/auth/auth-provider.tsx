/**
 * Real-mode AuthProvider -- uses cookie-based auth with the API.
 * CLIENT-R-01..04, CLIENT-R-28
 *
 * On mount and on window focus calls `GET /auth/me`.
 * 200 -> authenticated; 401 -> unauthenticated; other -> status `error`: the
 * session is unknown, the previous principal is kept and `error` is exposed.
 *
 * `stepUp()` opens the step-up dialog rendered here, so every screen gets it.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Principal, ActiveContext, MeResponse } from '@nestself/contracts';
import { createAuthApi, ApiError } from '@nestself/api-client';
import type { ApiClient } from '@nestself/api-client';
import { AuthContext } from './auth-context';
import { ME_TIMEOUT_MS, initialMe, releaseInitialMe } from './route-auth';
import { StepUpDialog } from './step-up-dialog';
import type { AuthStatus } from './types';

interface StepUpEntry {
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
}

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
  const [effectiveActions, setEffectiveActions] = useState<readonly string[]>([]);
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

  const loadPrincipal = useCallback(async (request?: Promise<MeResponse>) => {
    try {
      // A refresh gives up after the same time as the first load, so "Try
      // again" on the account error screen never waits on a hung API.
      const data = await (request ?? authApi.me({ signal: AbortSignal.timeout(ME_TIMEOUT_MS) }));
      applyMe(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPrincipal(null);
        setEffectiveActions([]);
        setStatus('unauthenticated');
        setError(null);
      } else {
        // Not a signed-out answer, so the session is unknown: keep the
        // principal the screens already have and report the failure. The next
        // refresh (window focus, "Try again") settles it either way.
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      }
    }
  }, [authApi, applyMe]);

  const refreshPrincipal = useCallback(() => loadPrincipal(), [loadPrincipal]);

  // Initial fetch: the same request the route guards wait for (route-auth.ts).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async: setState runs after await, not synchronously
    void loadPrincipal(initialMe(client)).finally(() => releaseInitialMe(client));
  }, [loadPrincipal, client]);

  // Refetch on window focus
  useEffect(() => {
    const handleFocus = () => void refreshPrincipal();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshPrincipal]);

  const signOut = useCallback(async () => {
    try {
      await authApi.signOut();
    } catch {
      // Best-effort: clear local state even if the request fails
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

  /** One entry per step-up request; concurrent callers share the same entry. */
  const [pendingStepUp, setPendingStepUp] = useState<StepUpEntry | null>(null);
  const pendingStepUpRef = useRef<StepUpEntry | null>(null);

  const stepUp = useCallback(() => {
    if (!pendingStepUpRef.current) {
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>((r) => {
        resolve = r;
      });
      const entry = { promise, resolve };
      pendingStepUpRef.current = entry;
      setPendingStepUp(entry);
    }
    return pendingStepUpRef.current.promise;
  }, []);

  /**
   * Settles one specific entry. A late callback from a dialog that was already
   * cancelled (its verify still in flight) must not close a newer step-up.
   */
  const finishStepUp = useCallback((entry: StepUpEntry, verified: boolean) => {
    entry.resolve(verified);
    if (pendingStepUpRef.current === entry) pendingStepUpRef.current = null;
    setPendingStepUp((current) => (current === entry ? null : current));
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
    [status, principal, effectiveActions, signOut, switchContext, stepUp, refreshPrincipal, error],
  );

  return (
    <AuthContext value={value}>
      {children}
      {pendingStepUp ? (
        <StepUpDialog
          open
          authApi={authApi}
          onVerified={() => finishStepUp(pendingStepUp, true)}
          onCancel={() => finishStepUp(pendingStepUp, false)}
        />
      ) : null}
    </AuthContext>
  );
}
