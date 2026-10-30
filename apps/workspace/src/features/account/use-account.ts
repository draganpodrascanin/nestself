/**
 * TanStack Query hooks over the signed-in user's own account
 * (`createAuthApi(api)`): profile, sessions and authenticator enrolment.
 *
 * None of these routes needs step-up; they are `@Authenticated()` and act on
 * the caller only. The server decides; these hooks only call it.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { createAuthApi } from '@nestself/api-client';
import type { AuthApi } from '@nestself/api-client';
import type { Locale } from '@nestself/contracts';
import { api } from '../../api';
import { useAuth } from '../../auth';

/** The slice of the auth API the account screens use (tests pass a fake). */
export type AccountApi = Pick<
  AuthApi,
  | 'listSessions'
  | 'revokeSession'
  | 'signOutAll'
  | 'updateDisplayName'
  | 'updateLocale'
  | 'totpEnrolSignedIn'
  | 'totpConfirm'
>;

export const accountApi: AccountApi = createAuthApi(api);

export const accountKeys = {
  sessions: ['account', 'sessions'] as const,
};

/**
 * Signed-in sessions. Disabled in sample mode and once the user is signed out,
 * so clearing the cache on sign-out does not refetch into a 401.
 */
export function useSessions(authApi: AccountApi, enabled: boolean) {
  const { status } = useAuth();
  return useQuery({
    queryKey: accountKeys.sessions,
    queryFn: async () => (await authApi.listSessions()).sessions,
    enabled: enabled && status === 'authenticated',
  });
}

/** Saves the display name, then reloads the principal so the shell shows it. */
export function useUpdateDisplayName(authApi: AccountApi) {
  const { refreshPrincipal } = useAuth();
  return useMutation({
    mutationFn: (displayName: string) => authApi.updateDisplayName(displayName),
    onSuccess: () => refreshPrincipal(),
  });
}

/** Persists the preferred locale on the account (also used for emails). */
export function useUpdateLocale(authApi: AccountApi) {
  const { refreshPrincipal } = useAuth();
  return useMutation({
    mutationFn: (locale: Locale) => authApi.updateLocale(locale),
    onSuccess: () => refreshPrincipal(),
  });
}

/** Ends another session of the caller; the current one goes through `signOut()`. */
export function useRevokeSession(authApi: AccountApi) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => authApi.revokeSession(sessionId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

/**
 * Signs the user out here and lands on `/sign-in` (no return path: the user
 * chose to leave). `signOut()` clears the session even when its request fails.
 */
export function useSignOutAndLeave() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return useCallback(async () => {
    await signOut();
    await navigate({ to: '/sign-in', replace: true });
  }, [signOut, navigate]);
}

/**
 * Ends every other session (`POST /auth/sign-out-all` keeps the caller's own),
 * then this one, so "everywhere" includes this browser.
 */
export function useSignOutEverywhere(authApi: AccountApi) {
  const leave = useSignOutAndLeave();
  return useMutation({
    mutationFn: () => authApi.signOutAll(),
    onSuccess: () => leave(),
  });
}

/**
 * Starts signed-in enrolment. The result carries the authenticator secret, so
 * it is never kept in the mutation cache once nothing observes it
 * (`gcTime: 0`); the screen also resets the mutation on cancel, success and
 * unmount.
 */
export function useTotpEnrolSignedIn(authApi: AccountApi) {
  return useMutation({ mutationFn: () => authApi.totpEnrolSignedIn(), gcTime: 0 });
}

/** Confirms the authenticator; the principal is reloaded for its second-factor flag. */
export function useTotpConfirm(authApi: AccountApi) {
  const { refreshPrincipal } = useAuth();
  return useMutation({
    mutationFn: (code: string) => authApi.totpConfirm(code),
    // The one-time code is the mutation's variables: do not keep it either.
    gcTime: 0,
    onSuccess: () => refreshPrincipal(),
  });
}
