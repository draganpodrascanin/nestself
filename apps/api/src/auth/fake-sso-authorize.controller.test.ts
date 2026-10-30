/**
 * The stub-only fake authorize route: registered only in stub mode, and
 * inert (404) whenever the identity provider is not the fake.
 */
import { describe, it, expect, vi } from 'vitest';
import { FakeSsoAuthorizeController } from './fake-sso-authorize.controller.js';
import { isStubAuthMode } from './fake-sso.module.js';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { IdentityProviderService } from '../identity/identity-provider.service.js';
import { ApiHttpException } from '../common/api-error.js';

const API = 'http://api.test';
const WORKSPACE = 'http://ws.test';
const ADMIN = 'http://admin.test';
const CALLBACK = `${API}/api/auth/sso/callback`;

function config(authMode?: string) {
  const values: Record<string, string | undefined> = {
    API_PUBLIC_URL: API,
    WORKSPACE_URL: `${WORKSPACE}/`,
    ADMIN_URL: ADMIN,
    AUTH_MODE: authMode,
  };
  return { get: (key: string, fallback?: string) => values[key] ?? fallback };
}

function res() {
  return { setHeader: vi.fn(), redirect: vi.fn() };
}

const QUERY = { connection: 'org-acme-oidc', state: 's', code_challenge: 'c'.repeat(43), redirect_uri: CALLBACK };

function status(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ApiHttpException ? err.getStatus() : -1;
  }
}

describe('isStubAuthMode (ConditionalModule predicate)', () => {
  it('registers the fake route in stub mode and by default, never with cognito', () => {
    expect(isStubAuthMode({ AUTH_MODE: 'stub' })).toBe(true);
    expect(isStubAuthMode({})).toBe(true);
    expect(isStubAuthMode({ AUTH_MODE: 'cognito' })).toBe(false);
  });
});

describe('FakeSsoAuthorizeController', () => {
  it('404s when the identity provider is not the fake (Cognito)', () => {
    const cognitoLike = Object.create(IdentityProviderService.prototype) as IdentityProviderService;
    const controller = new FakeSsoAuthorizeController(cognitoLike, config('stub') as never);
    const r = res();
    expect(status(() => controller.authorize(QUERY, r))).toBe(404);
    expect(r.redirect).not.toHaveBeenCalled();
  });

  it('404s with AUTH_MODE=cognito even if the fake were wired', () => {
    const controller = new FakeSsoAuthorizeController(new FakeIdentityProvider({ apiPublicUrl: API }), config('cognito') as never);
    expect(status(() => controller.authorize(QUERY, res()))).toBe(404);
  });

  it.each([
    'https://evil.example/cb',
    'https://evil.example/api/auth/sso/callback',
    `${ADMIN}/api/auth/sso/callback/extra`,
    `${ADMIN}/api/auth/sso/callback?x=1`,
    `${ADMIN}:8443/api/auth/sso/callback`,
    `${WORKSPACE}/sign-in`,
  ])('refuses %s: only the registered callbacks', (redirectUri) => {
    const controller = new FakeSsoAuthorizeController(new FakeIdentityProvider({ apiPublicUrl: API }), config('stub') as never);
    expect(status(() => controller.authorize({ ...QUERY, redirect_uri: redirectUri }, res()))).toBe(400);
  });

  it.each([
    `${WORKSPACE}/api/auth/sso/callback`,
    `${ADMIN}/api/auth/sso/callback`,
    `${API}/api/auth/sso/callback`,
  ])('accepts the registered callback %s and redirects there', async (redirectUri) => {
    const idp = new FakeIdentityProvider({ apiPublicUrl: API });
    await idp.createProvider({ name: 'org-acme-oidc', protocol: 'OIDC', oidcIssuer: 'https://i', oidcClientId: 'c', attributeMapping: {} });
    const controller = new FakeSsoAuthorizeController(idp, config('stub') as never);
    const r = res();
    controller.authorize({ ...QUERY, redirect_uri: redirectUri, as: 'a@acme.example' }, r);
    const url = new URL(r.redirect.mock.calls[0]![1] as string);
    expect(url.origin + url.pathname).toBe(redirectUri);
  });

  it('redirects to the callback with a code and the state for the user chosen with as=', async () => {
    const idp = new FakeIdentityProvider({ apiPublicUrl: API });
    await idp.createProvider({ name: 'org-acme-oidc', protocol: 'OIDC', oidcIssuer: 'https://i', oidcClientId: 'c', attributeMapping: {} });
    const controller = new FakeSsoAuthorizeController(idp, config('stub') as never);
    const r = res();
    controller.authorize({ ...QUERY, as: 'Someone@Acme.example' }, r);
    const [code, location] = r.redirect.mock.calls[0]!;
    expect(code).toBe(302);
    const url = new URL(location as string);
    expect(url.origin + url.pathname).toBe(CALLBACK);
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(idp.listFederatedUsers('org-acme-oidc').map((u) => u.email)).toEqual(['someone@acme.example']);
  });
});
