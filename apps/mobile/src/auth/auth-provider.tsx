/**
 * AuthProvider: manages the full authentication lifecycle for the mobile app.
 *
 * In **sample mode** (EXPO_PUBLIC_DATA_SOURCE unset in __DEV__, or explicitly
 * "sample") no network calls are made and SAMPLE_PRINCIPALS.employee is used.
 * In **api mode** (EXPO_PUBLIC_DATA_SOURCE === "api") the provider talks to
 * Cognito and the NestSelf API.
 *
 * @see auth-strategy.md 6.2, 6.5
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import { createApiClient, createAuthApi, ApiError } from '@nestself/api-client';
import type { DiscoverResponse, Principal } from '@nestself/contracts';

import { getCognitoConfig } from './config';
import { createCognitoPublicClient } from './cognito-public-client';
import type { CognitoPublicClient } from './cognito-public-client';
import { decodeJwtClaims } from './jwt';
import {
  storeTokens,
  updateAccessToken,
  getAccessToken,
  getRefreshToken,
  getTokenFamily,
  getLastApiCallAt,
  setLastApiCallAt,
  clearTokens,
} from './token-store';
import { authReducer, INITIAL_STATE } from './auth-state';
import type { AuthState, AuthErrorInfo } from './auth-state';

// ---------------------------------------------------------------------------
// Sample-mode detection (mirrors the web rule)
// ---------------------------------------------------------------------------

function resolveDataMode(): 'sample' | 'api' {
  const explicit = process.env.EXPO_PUBLIC_DATA_SOURCE;
  if (explicit === 'api') return 'api';
  if (explicit === 'sample') return 'sample';
  // Unset => sample in dev, api in production
  // __DEV__ is a React Native global
  return typeof __DEV__ !== 'undefined' && __DEV__ ? 'sample' : 'api';
}

export const DATA_MODE = resolveDataMode();

// ---------------------------------------------------------------------------
// 30-day staleness threshold (CLIENT-R-25)
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Minimum TTL before refresh (CLIENT-R-20): 2 minutes
// ---------------------------------------------------------------------------

const MIN_TTL_SECONDS = 120;

// ---------------------------------------------------------------------------
// Context value shape
// ---------------------------------------------------------------------------

export interface AuthContextValue extends AuthState {
  signInWithEmailOtp: {
    start: (email: string) => Promise<void>;
    verify: (code: string) => Promise<void>;
  };
  signInWithSso: (connection: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshPrincipal: () => Promise<void>;
  discover: (email: string) => Promise<DiscoverResponse>;
  /** CLIENT-R-22: no-op until the push endpoint exists. */
  registerPushToken: () => void;
  /** Get a fresh access token (refreshing if needed). */
  getToken: () => Promise<string | null>;
  /** The token family (origin_jti) for the X-Token-Family header. */
  tokenFamily: string | null;
  /** Whether we are in sample mode. */
  isSampleMode: boolean;
  /** Complete SSO sign-in after token exchange (used by sign-in screen). */
  completeSsoSignIn: (tokens: {
    accessToken: string;
    idToken: string;
    refreshToken: string;
  }) => Promise<void>;
  /** Sample-mode sign-in (used by sign-in screen). */
  sampleSignIn: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, INITIAL_STATE);
  const isSample = DATA_MODE === 'sample';

  // Refs to avoid stale closures in token refresh
  const refreshingRef = useRef<Promise<string | null> | null>(null);
  const tokenFamilyRef = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // API client (api mode only; lazily initialised)
  // ---------------------------------------------------------------------------

  const apiClientRef = useRef<ReturnType<typeof createApiClient> | null>(null);
  const authApiRef = useRef<ReturnType<typeof createAuthApi> | null>(null);
  const cognitoRef = useRef<CognitoPublicClient | null>(null);

  function ensureApiClient() {
    if (!apiClientRef.current) {
      const baseUrl = process.env.EXPO_PUBLIC_API_URL;
      if (!baseUrl) throw new Error('EXPO_PUBLIC_API_URL is not set');
      apiClientRef.current = createApiClient({
        baseUrl,
        mode: 'bearer',
        getToken: () => getTokenAsync(),
        fetchImpl: fetch,
      });
      authApiRef.current = createAuthApi(apiClientRef.current);
    }
    return { client: apiClientRef.current, authApi: authApiRef.current! };
  }

  function ensureCognito(): CognitoPublicClient {
    if (!cognitoRef.current) {
      const config = getCognitoConfig();
      cognitoRef.current = createCognitoPublicClient(config);
    }
    return cognitoRef.current;
  }

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  /** Returns a valid access token, refreshing if about to expire. */
  async function getTokenAsync(): Promise<string | null> {
    // If already refreshing, wait for it
    if (refreshingRef.current) {
      return refreshingRef.current;
    }

    const token = await getAccessToken();
    if (!token) return null;

    const claims = decodeJwtClaims(token);
    if (!claims?.exp) return token;

    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.exp - nowSec > MIN_TTL_SECONDS) {
      return token;
    }

    // Token about to expire; refresh
    return doRefresh();
  }

  async function doRefresh(): Promise<string | null> {
    if (refreshingRef.current) return refreshingRef.current;

    const promise = (async () => {
      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) {
          dispatch({ type: 'REFRESH_FAILED' });
          return null;
        }

        const cognito = ensureCognito();
        const result = await cognito.refreshTokens(refreshToken);

        const claims = decodeJwtClaims(result.accessToken);
        const family = claims?.origin_jti ?? claims?.jti ?? null;
        tokenFamilyRef.current = family;

        await updateAccessToken(result.accessToken, result.idToken, family);
        return result.accessToken;
      } catch (err) {
        // not_authorized on refresh means the refresh token is revoked
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'not_authorized') {
          await clearTokens();
          dispatch({ type: 'REFRESH_FAILED' });
          return null;
        }
        throw err;
      } finally {
        refreshingRef.current = null;
      }
    })();

    refreshingRef.current = promise;
    return promise;
  }

  // ---------------------------------------------------------------------------
  // Fetch /auth/me with 401 retry (CLIENT-R-23)
  // ---------------------------------------------------------------------------

  async function fetchMe(retried = false): Promise<{ principal: Principal; effectiveActions: readonly string[] }> {
    const { authApi } = ensureApiClient();
    try {
      const resp = await authApi.me();
      await setLastApiCallAt(Date.now());
      return { principal: resp.principal, effectiveActions: resp.effectiveActions };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && !retried) {
        // One refresh attempt
        const newToken = await doRefresh();
        if (newToken) {
          return fetchMe(true);
        }
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Boot sequence
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isSample) {
      // Sample mode: auto-authenticate as the sample employee
      // (user still sees the sign-in screen first; this just loads the
      // principal; the auth layout redirects based on status)
      dispatch({ type: 'LOAD_NO_TOKENS' });
      return;
    }

    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          dispatch({ type: 'LOAD_NO_TOKENS' });
          return;
        }

        // Check 30-day staleness (CLIENT-R-25)
        const lastCall = await getLastApiCallAt();
        if (lastCall && Date.now() - lastCall > THIRTY_DAYS_MS) {
          await clearTokens();
          dispatch({ type: 'LOAD_STALE' });
          return;
        }

        // Try to refresh if token is near expiry
        const claims = decodeJwtClaims(token);
        const nowSec = Math.floor(Date.now() / 1000);
        if (claims?.exp && claims.exp - nowSec <= MIN_TTL_SECONDS) {
          const refreshed = await doRefresh();
          if (!refreshed) {
            dispatch({ type: 'LOAD_REFRESH_FAILED' });
            return;
          }
        }

        // Load principal
        const tokenFamily = await getTokenFamily();
        tokenFamilyRef.current = tokenFamily;

        const { principal, effectiveActions } = await fetchMe();
        dispatch({ type: 'LOAD_ME_SUCCESS', principal, effectiveActions });
      } catch {
        await clearTokens();
        dispatch({ type: 'LOAD_ME_FAILED' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const startEmailOtp = useCallback(async (email: string) => {
    try {
      const cognito = ensureCognito();
      const result = await cognito.initiateEmailOtp(email);
      dispatch({ type: 'OTP_STARTED', session: result.session, email });
    } catch (err) {
      const info = mapCognitoError(err);
      dispatch({ type: 'SET_ERROR', error: info });
      throw err;
    }
  }, []);

  const verifyEmailOtp = useCallback(async (code: string) => {
    const { otpSession, signInEmail } = state;
    if (!otpSession || !signInEmail) {
      throw new Error('No OTP session in progress');
    }

    try {
      const cognito = ensureCognito();
      const tokens = await cognito.respondToEmailOtp(otpSession, signInEmail, code);

      const claims = decodeJwtClaims(tokens.accessToken);
      const family = claims?.origin_jti ?? claims?.jti ?? null;
      tokenFamilyRef.current = family;

      await storeTokens({
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
        refreshToken: tokens.refreshToken,
        tokenFamily: family,
      });

      const me = await fetchMe();
      dispatch({
        type: 'OTP_VERIFY_SUCCESS',
        principal: me.principal,
        effectiveActions: me.effectiveActions,
      });
    } catch (err) {
      const info = mapCognitoError(err);
      dispatch({ type: 'SET_ERROR', error: info });
      throw err;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.otpSession, state.signInEmail]);

  const signInWithSso = useCallback(async (_connection: string) => {
    // SSO token exchange is handled by the useSsoSignIn hook.
    // This function is called after the hook returns tokens.
    // The sign-in screen calls storeSsoTokens directly.
    throw new Error(
      'signInWithSso is called by the sign-in screen after useSsoSignIn completes. ' +
        'Use storeSsoTokens() instead.',
    );
  }, []);

  /** Called by the sign-in screen after SSO tokens are obtained. */
  const completeSsoSignIn = useCallback(async (tokens: {
    accessToken: string;
    idToken: string;
    refreshToken: string;
  }) => {
    const claims = decodeJwtClaims(tokens.accessToken);
    const family = claims?.origin_jti ?? claims?.jti ?? null;
    tokenFamilyRef.current = family;

    await storeTokens({
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      tokenFamily: family,
    });

    const me = await fetchMe();
    dispatch({
      type: 'SSO_SUCCESS',
      principal: me.principal,
      effectiveActions: me.effectiveActions,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sampleSignIn = useCallback(() => {
    const sample = SAMPLE_PRINCIPALS.employee;
    dispatch({
      type: 'SAMPLE_SIGN_IN',
      principal: sample.principal,
      effectiveActions: [...sample.effectiveActions],
    });
  }, []);

  const signOutFn = useCallback(async () => {
    if (isSample) {
      dispatch({ type: 'SIGN_OUT' });
      return;
    }

    // Best-effort API sign-out (bearer)
    try {
      const { authApi } = ensureApiClient();
      await authApi.signOut();
    } catch {
      // Best effort
    }

    // Best-effort Cognito revoke
    try {
      const refreshToken = await getRefreshToken();
      if (refreshToken) {
        const cognito = ensureCognito();
        await cognito.revokeToken(refreshToken);
      }
    } catch {
      // Best effort
    }

    await clearTokens();
    tokenFamilyRef.current = null;
    dispatch({ type: 'SIGN_OUT' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSample]);

  const refreshPrincipal = useCallback(async () => {
    if (isSample) return;
    try {
      const me = await fetchMe();
      dispatch({
        type: 'PRINCIPAL_REFRESHED',
        principal: me.principal,
        effectiveActions: me.effectiveActions,
      });
    } catch {
      // Refresh failed silently; principal stays as-is
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSample]);

  const discover = useCallback(async (email: string): Promise<DiscoverResponse> => {
    const { authApi } = ensureApiClient();
    const result = await authApi.discover(email);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** CLIENT-R-22: no-op until the push registration endpoint exists. */
  const registerPushToken = useCallback(() => {
    // No-op: the API endpoint POST /auth/push-token does not exist yet.
    // When implemented, this will send the Expo push token to the API.
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (isSample) return null;
    return getTokenAsync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSample]);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signInWithEmailOtp: {
        start: startEmailOtp,
        verify: verifyEmailOtp,
      },
      signInWithSso,
      signOut: signOutFn,
      refreshPrincipal,
      discover,
      registerPushToken,
      getToken,
      tokenFamily: tokenFamilyRef.current,
      isSampleMode: isSample,
      // Expose for the sign-in screen
      completeSsoSignIn,
      sampleSignIn,
    }),
    [
      state,
      startEmailOtp,
      verifyEmailOtp,
      signInWithSso,
      signOutFn,
      refreshPrincipal,
      discover,
      registerPushToken,
      getToken,
      isSample,
      completeSsoSignIn,
      sampleSignIn,
    ],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

// ---------------------------------------------------------------------------
// Error mapping helpers
// ---------------------------------------------------------------------------

function mapCognitoError(err: unknown): AuthErrorInfo {
  if (err instanceof Error && 'code' in err) {
    const code = (err as { code: string }).code;
    return { code, message: err.message };
  }
  if (err instanceof ApiError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'unknown', message: 'An unexpected error occurred' };
}
