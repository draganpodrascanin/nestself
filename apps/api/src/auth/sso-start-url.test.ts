/**
 * The API origin of a surface (fix wave 2): every SPA proxies `/api` to the
 * API, so a surface's SSO URLs live on that surface's own origin and the
 * host-only session cookie lands where `/api/auth/me` asks for it.
 */
import { describe, it, expect } from 'vitest';
import { apiOriginForSurface, buildSsoStartUrl, registeredSsoCallbackUrls, ssoCallbackUrl } from './sso-start-url.js';

function config(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] };
}

const DEPLOYED = config({
  WORKSPACE_URL: 'https://app.staging.nestself.example/',
  ADMIN_URL: 'https://admin.staging.nestself.example',
  API_PUBLIC_URL: 'https://app.staging.nestself.example',
});

describe('apiOriginForSurface', () => {
  it('is the workspace origin for the workspace surface', () => {
    expect(apiOriginForSurface(DEPLOYED, 'workspace')).toBe('https://app.staging.nestself.example');
  });

  it('is the admin origin for the admin surface, not API_PUBLIC_URL', () => {
    expect(apiOriginForSurface(DEPLOYED, 'admin')).toBe('https://admin.staging.nestself.example');
  });

  it('keeps only the origin of a surface URL with a path', () => {
    expect(apiOriginForSurface(config({ ADMIN_URL: 'http://localhost:5174/some/path' }), 'admin')).toBe(
      'http://localhost:5174',
    );
  });

  it('falls back to API_PUBLIC_URL when the surface URL is unset (stub mode only)', () => {
    expect(apiOriginForSurface(config({ API_PUBLIC_URL: 'http://api.test/' }), 'admin')).toBe('http://api.test');
    expect(apiOriginForSurface(config({ WORKSPACE_URL: '', API_PUBLIC_URL: 'http://api.test' }), 'workspace')).toBe(
      'http://api.test',
    );
  });

  it('falls back to the local API when nothing is set', () => {
    expect(apiOriginForSurface(config({}), 'workspace')).toBe('http://localhost:4000');
  });
});

describe('ssoCallbackUrl and registeredSsoCallbackUrls', () => {
  it('builds the callback on the surface origin', () => {
    expect(ssoCallbackUrl(DEPLOYED, 'admin')).toBe('https://admin.staging.nestself.example/api/auth/sso/callback');
  });

  it('registers the workspace, admin and API_PUBLIC_URL callbacks, deduplicated', () => {
    expect(registeredSsoCallbackUrls(DEPLOYED)).toEqual([
      'https://app.staging.nestself.example/api/auth/sso/callback',
      'https://admin.staging.nestself.example/api/auth/sso/callback',
    ]);
    expect(
      registeredSsoCallbackUrls(
        config({ WORKSPACE_URL: 'http://localhost:5173', ADMIN_URL: 'http://localhost:5174', API_PUBLIC_URL: 'http://localhost:4000' }),
      ),
    ).toEqual([
      'http://localhost:5173/api/auth/sso/callback',
      'http://localhost:5174/api/auth/sso/callback',
      'http://localhost:4000/api/auth/sso/callback',
    ]);
  });
});

describe('buildSsoStartUrl', () => {
  it('puts the start route on the given origin', () => {
    expect(buildSsoStartUrl('https://admin.staging.nestself.example', { connection: 'org-a-saml', surface: 'admin' })).toBe(
      'https://admin.staging.nestself.example/api/auth/sso/start?connection=org-a-saml&surface=admin',
    );
  });
});
