/**
 * SSO sign-in via expo-auth-session with standard PKCE.
 *
 * Builds an authorization request against the Cognito Hosted UI
 * with `identity_provider=<connection>` so the user goes straight
 * to their org IdP without seeing the Cognito sign-in page.
 *
 * @see auth-strategy.md 6.2, Appendix D.4
 */

import {
  makeRedirectUri,
  useAuthRequest,
  exchangeCodeAsync,
  type DiscoveryDocument,
  type AuthSessionResult,
} from 'expo-auth-session';
import { useCallback } from 'react';
import type { CognitoConfig } from './config';

// ---------------------------------------------------------------------------
// Pure config builder (unit-tested)
// ---------------------------------------------------------------------------

export interface SsoRequestConfig {
  discovery: DiscoveryDocument;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  extraParams: Record<string, string>;
}

export function buildSsoRequestConfig(
  config: CognitoConfig,
  connection: string,
): SsoRequestConfig {
  const { domain, clientId } = config;
  const base = domain.endsWith('/') ? domain.slice(0, -1) : domain;

  return {
    discovery: {
      authorizationEndpoint: `${base}/oauth2/authorize`,
      tokenEndpoint: `${base}/oauth2/token`,
      revocationEndpoint: `${base}/oauth2/revoke`,
    },
    clientId,
    redirectUri: makeRedirectUri({ scheme: 'nestself', path: 'auth/callback' }),
    scopes: ['openid', 'email', 'profile'],
    extraParams: { identity_provider: connection },
  };
}

// ---------------------------------------------------------------------------
// SSO tokens result
// ---------------------------------------------------------------------------

export interface SsoTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Placeholder discovery for the hook when no connection is set yet.
// useAuthRequest requires a non-null discovery; a placeholder means the
// request object stays null (unusable) until the real connection arrives.
// ---------------------------------------------------------------------------

const PLACEHOLDER_DISCOVERY: DiscoveryDocument = {
  authorizationEndpoint: 'https://placeholder.invalid/oauth2/authorize',
  tokenEndpoint: 'https://placeholder.invalid/oauth2/token',
};

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useSsoSignIn(
  config: CognitoConfig,
  connection: string | null,
): {
  promptAsync: (() => Promise<SsoTokens>) | null;
  isReady: boolean;
} {
  const ssoConfig = connection
    ? buildSsoRequestConfig(config, connection)
    : null;

  // useAuthRequest requires an AuthRequestConfig; pass a dummy when no
  // connection is set. The request will be null because the discovery
  // endpoint is unreachable, which is exactly what we want.
  const requestConfig = ssoConfig
    ? {
        clientId: ssoConfig.clientId,
        redirectUri: ssoConfig.redirectUri,
        scopes: ssoConfig.scopes,
        usePKCE: true,
        extraParams: ssoConfig.extraParams,
      }
    : {
        clientId: config.clientId || 'placeholder',
        redirectUri: 'nestself://auth/callback',
        scopes: ['openid'],
        usePKCE: true,
      };

  const discovery = ssoConfig?.discovery ?? PLACEHOLDER_DISCOVERY;

  const [request, , promptAsyncRaw] = useAuthRequest(requestConfig, discovery);

  const promptAsync = useCallback(async (): Promise<SsoTokens> => {
    if (!request || !ssoConfig) {
      throw new Error('SSO request is not ready');
    }

    const result: AuthSessionResult = await promptAsyncRaw();

    if (result.type !== 'success') {
      throw new Error(
        result.type === 'cancel'
          ? 'SSO sign-in was cancelled'
          : `SSO sign-in failed: ${result.type}`,
      );
    }

    const { code } = result.params;
    if (!code) {
      throw new Error('No authorization code in SSO response');
    }

    const tokenResponse = await exchangeCodeAsync(
      {
        clientId: ssoConfig.clientId,
        code,
        redirectUri: ssoConfig.redirectUri,
        extraParams: {
          code_verifier: request.codeVerifier ?? '',
        },
      },
      ssoConfig.discovery,
    );

    if (!tokenResponse.accessToken || !tokenResponse.idToken || !tokenResponse.refreshToken) {
      throw new Error('SSO token exchange returned incomplete tokens');
    }

    return {
      accessToken: tokenResponse.accessToken,
      idToken: tokenResponse.idToken,
      refreshToken: tokenResponse.refreshToken,
    };
  }, [request, ssoConfig, promptAsyncRaw]);

  return {
    promptAsync: request && ssoConfig ? promptAsync : null,
    isReady: !!request && !!ssoConfig,
  };
}
