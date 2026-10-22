import { describe, it, expect, vi } from 'vitest';

// Mock expo-auth-session so buildSsoRequestConfig can call makeRedirectUri
vi.mock('expo-auth-session', () => ({
  makeRedirectUri: vi.fn(({ scheme, path }: { scheme: string; path: string }) => `${scheme}://${path}`),
  useAuthRequest: vi.fn(() => [null, null, vi.fn()]),
  exchangeCodeAsync: vi.fn(),
}));

import { buildSsoRequestConfig } from './sso';
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
