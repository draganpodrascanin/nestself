import { describe, it, expect, vi } from 'vitest';

// Mock expo-auth-session so buildSsoRequestConfig can call makeRedirectUri
vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(({ scheme, path }: { scheme: string; path: string }) => `${scheme}://${path}`),
  useAuthRequest: vi.fn(() => [null, null, vi.fn()]),
  exchangeCodeAsync: vi.fn(),
}));

import { ApiError } from '@nestself/api-client';
import { buildSsoRequestConfig, finishSsoSignIn, type SsoTokens } from './sso';
import type { CognitoConfig } from './config';

const CONFIG: CognitoConfig = {
  region: 'eu-central-1',
  userPoolId: 'eu-central-1_TestPool',
  clientId: 'test-client-id',
  domain: 'https://test.auth.eu-central-1.amazoncognito.com',
};

describe('buildSsoRequestConfig', () => {
  it('builds discovery endpoints from the domain', () => {
    const result = buildSsoRequestConfig(CONFIG, 'OktaSAML');

    expect(result.discovery.authorizationEndpoint).toBe(
      'https://test.auth.eu-central-1.amazoncognito.com/oauth2/authorize',
    );
    expect(result.discovery.tokenEndpoint).toBe(
      'https://test.auth.eu-central-1.amazoncognito.com/oauth2/token',
    );
    expect(result.discovery.revocationEndpoint).toBe(
      'https://test.auth.eu-central-1.amazoncognito.com/oauth2/revoke',
    );
  });

  it('uses the correct client ID', () => {
    const result = buildSsoRequestConfig(CONFIG, 'AzureAD');
    expect(result.clientId).toBe('test-client-id');
  });

  it('sets the identity_provider in extraParams', () => {
    const result = buildSsoRequestConfig(CONFIG, 'OktaSAML');
    expect(result.extraParams).toEqual({ identity_provider: 'OktaSAML' });
  });

  it('includes required scopes', () => {
    const result = buildSsoRequestConfig(CONFIG, 'AzureAD');
    expect(result.scopes).toEqual(['openid', 'email', 'profile']);
  });

  it('strips trailing slash from domain', () => {
    const configWithSlash = { ...CONFIG, domain: CONFIG.domain + '/' };
    const result = buildSsoRequestConfig(configWithSlash, 'Test');
    expect(result.discovery.authorizationEndpoint).toBe(
      'https://test.auth.eu-central-1.amazoncognito.com/oauth2/authorize',
    );
  });

  it('generates a redirect URI with nestself scheme', () => {
    const result = buildSsoRequestConfig(CONFIG, 'Test');
    expect(result.redirectUri).toBe('nestself://auth/callback');
  });
});

describe('finishSsoSignIn', () => {
  const TOKENS: SsoTokens = { accessToken: 'access-token', idToken: 'id-token', refreshToken: 'refresh-token' };
  const ME = { principal: { userId: 'u-1' }, effectiveActions: [] };

  /** The app's steps, recording the order they run in; `bind` decides what the API answers. */
  function steps(bind: () => Promise<void> = async () => {}) {
    const order: string[] = [];
    return {
      order,
      steps: {
        bindToken: vi.fn(async (idToken: string) => {
          order.push(`bind ${idToken}`);
          await bind();
        }),
        storeTokens: vi.fn(async () => {
          order.push('store');
        }),
        clearTokens: vi.fn(async () => {
          order.push('clear');
        }),
        loadPrincipal: vi.fn(async () => {
          order.push('me');
          return ME;
        }),
      },
    };
  }

  it('lets the API bind the ID token before it keeps the tokens and loads the principal', async () => {
    const { order, steps: s } = steps();

    await expect(finishSsoSignIn(TOKENS, s)).resolves.toBe(ME);

    expect(order).toEqual(['bind id-token', 'store', 'me']);
    expect(s.storeTokens).toHaveBeenCalledWith(TOKENS);
  });

  it.each(['sso_denied', 'sso_email_unverified'])(
    'a binding refused with %s keeps no tokens, clears any left over and loads no principal',
    async (code) => {
      const refused = new ApiError({ status: 403, code, message: 'refused', requestId: null });
      const { order, steps: s } = steps(async () => {
        throw refused;
      });

      await expect(finishSsoSignIn(TOKENS, s)).rejects.toBe(refused);

      expect(order).toEqual(['bind id-token', 'clear']);
      expect(s.storeTokens).not.toHaveBeenCalled();
      expect(s.loadPrincipal).not.toHaveBeenCalled();
    },
  );

  it('a binding that could not reach the API keeps no tokens either', async () => {
    const offline = new ApiError({ status: 0, code: 'network', message: 'Network request failed', requestId: null });
    const { order, steps: s } = steps(async () => {
      throw offline;
    });

    await expect(finishSsoSignIn(TOKENS, s)).rejects.toBe(offline);
    expect(order).toEqual(['bind id-token', 'clear']);
  });
});
