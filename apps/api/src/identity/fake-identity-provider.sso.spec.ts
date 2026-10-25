import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeIdentityProvider } from './fake-identity-provider.js';
import { s256, AUTHORIZATION_CODE_TTL_MS } from './fake-sso-store.js';
import { decodeJwtClaims } from './identity-provider.service.js';
import type { ProviderInput } from './identity-provider.service.js';
import { SAMPLE_SAML_METADATA, SIGNING_CERT_NOT_AFTER } from './saml-metadata.fixture.js';

const SAML: ProviderInput = {
  name: 'org-acme-saml',
  protocol: 'SAML',
  metadataUrl: 'https://idp.acme.example/metadata',
  attributeMapping: {},
};
const VERIFIER = 'verifier-0123456789-abcdefghijklmnopqrstuvwxyz';
const REDIRECT = 'http://localhost:4000/api/auth/sso/callback';

describe('FakeIdentityProvider: enterprise SSO', () => {
  let idp: FakeIdentityProvider;

  beforeEach(async () => {
    idp = new FakeIdentityProvider();
    await idp.createProvider(SAML);
    idp.seedFederatedUsers([
      { providerName: SAML.name, subject: 'ana-nameid', email: 'Ana@Acme.example', emailVerified: true },
      { providerName: SAML.name, subject: 'unverified', email: 'u@acme.example', emailVerified: false },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('providers', () => {
    it('creates, lists, describes, updates and deletes', async () => {
      await expect(idp.listProviders()).resolves.toEqual([SAML.name]);
      await expect(idp.describeProvider(SAML.name)).resolves.toEqual({
        name: SAML.name,
        protocol: 'SAML',
        certificateExpiresAt: null,
      });

      await idp.updateProvider({ ...SAML, metadataUrl: undefined, metadataXml: SAMPLE_SAML_METADATA });
      await expect(idp.describeProvider(SAML.name)).resolves.toMatchObject({
        certificateExpiresAt: SIGNING_CERT_NOT_AFTER,
      });

      await idp.deleteProvider(SAML.name);
      await expect(idp.describeProvider(SAML.name)).resolves.toBeNull();
      await expect(idp.listProviders()).resolves.toEqual([]);
      await expect(idp.deleteProvider(SAML.name)).resolves.toBeUndefined();
    });

    it('returns a seeded certificate expiry', async () => {
      const at = new Date('2026-11-20T00:00:00Z');
      idp.setProviderCertificateExpiry(SAML.name, at);
      await expect(idp.describeProvider(SAML.name)).resolves.toMatchObject({ certificateExpiresAt: at });
    });

    it('refuses a duplicate name and an update of an unknown provider', async () => {
      await expect(idp.createProvider(SAML)).rejects.toMatchObject({ code: 'provider_exists' });
      await expect(idp.updateProvider({ ...SAML, name: 'org-none-saml' })).rejects.toMatchObject({
        code: 'provider_not_found',
      });
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('points at the stub authorize route of the API (default origin)', () => {
      const url = idp.buildAuthorizeUrl({
        providerName: SAML.name,
        state: 'st',
        codeChallenge: 'ch',
        redirectUri: REDIRECT,
      });
      expect(url).toBe(
        'http://localhost:4000/api/auth/sso/_fake/authorize?connection=org-acme-saml&state=st&code_challenge=ch' +
          `&redirect_uri=${encodeURIComponent(REDIRECT)}`,
      );
    });

    it('stays on the origin of the redirect URI (the surface origin), whatever API_PUBLIC_URL says', () => {
      const other = new FakeIdentityProvider({ apiPublicUrl: 'https://api.nestself.example/' });
      const url = new URL(
        other.buildAuthorizeUrl({
          providerName: 'p',
          state: 's',
          codeChallenge: 'c',
          redirectUri: 'https://admin.nestself.example/api/auth/sso/callback',
        }),
      );
      expect(url.origin + url.pathname).toBe('https://admin.nestself.example/api/auth/sso/_fake/authorize');
    });

    it('uses API_PUBLIC_URL when the redirect URI does not parse', () => {
      const other = new FakeIdentityProvider({ apiPublicUrl: 'https://api.nestself.example/' });
      const url = new URL(
        other.buildAuthorizeUrl({ providerName: 'p', state: 's', codeChallenge: 'c', redirectUri: 'not a url' }),
      );
      expect(url.origin + url.pathname).toBe('https://api.nestself.example/api/auth/sso/_fake/authorize');
    });
  });

  describe('authorization code', () => {
    it('exchanges a code with the matching verifier for tokens of the federated pool user', async () => {
      const code = idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER));
      const result = await idp.exchangeAuthorizationCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT });

      expect(result.idTokenClaims).toMatchObject({
        email: 'ana@acme.example',
        emailVerified: true,
        identities: [{ providerName: SAML.name, userId: 'ana-nameid' }],
        username: 'org-acme-saml_ana-nameid',
      });
      expect(result.idTokenClaims.sub).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.idTokenClaims.authTime).toBeGreaterThan(0);

      const claims = decodeJwtClaims(result.idToken) as Record<string, unknown>;
      expect(claims['identities']).toEqual([
        { providerName: SAML.name, userId: 'ana-nameid', providerType: 'SAML' },
      ]);
      expect(claims['cognito:username']).toBe('org-acme-saml_ana-nameid');

      // The pool user is stable across sign-ins and refreshable.
      const again = await idp.exchangeAuthorizationCode({
        code: idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER)),
        codeVerifier: VERIFIER,
        redirectUri: REDIRECT,
      });
      expect(again.idTokenClaims.sub).toBe(result.idTokenClaims.sub);
      await expect(idp.refresh({ refreshToken: result.refreshToken! })).resolves.toHaveProperty('accessToken');
    });

    it('carries an unverified email through', async () => {
      const code = idp.issueAuthorizationCode(SAML.name, 'unverified', s256(VERIFIER));
      const result = await idp.exchangeAuthorizationCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT });
      expect(result.idTokenClaims.emailVerified).toBe(false);
    });

    it('is single use, even after a wrong verifier', async () => {
      const code = idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER));
      await expect(
        idp.exchangeAuthorizationCode({ code, codeVerifier: 'wrong-verifier', redirectUri: REDIRECT }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
      await expect(
        idp.exchangeAuthorizationCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT }),
      ).rejects.toMatchObject({ code: 'invalid_code' });

      const used = idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER));
      await idp.exchangeAuthorizationCode({ code: used, codeVerifier: VERIFIER, redirectUri: REDIRECT });
      await expect(
        idp.exchangeAuthorizationCode({ code: used, codeVerifier: VERIFIER, redirectUri: REDIRECT }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
    });

    it('expires after 10 minutes', async () => {
      vi.useFakeTimers();
      const code = idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER));
      vi.advanceTimersByTime(AUTHORIZATION_CODE_TTL_MS + 1);
      await expect(
        idp.exchangeAuthorizationCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
    });

    it('rejects an unknown code and a different redirect URI when the code is bound to one', async () => {
      await expect(
        idp.exchangeAuthorizationCode({ code: 'nope', codeVerifier: VERIFIER, redirectUri: REDIRECT }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
      const code = idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER), REDIRECT);
      await expect(
        idp.exchangeAuthorizationCode({ code, codeVerifier: VERIFIER, redirectUri: 'http://evil.example/cb' }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
    });

    it('refuses to redeem a code whose provider was deleted meanwhile', async () => {
      const code = idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER));
      await idp.deleteProvider(SAML.name);
      await expect(
        idp.exchangeAuthorizationCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT }),
      ).rejects.toMatchObject({ code: 'invalid_code' });
    });

    it('refuses to issue a code for an unregistered provider or an unseeded subject', () => {
      expect(() => idp.issueAuthorizationCode('org-none-saml', 'ana-nameid', 'c')).toThrow(
        expect.objectContaining({ code: 'provider_not_found' }),
      );
      expect(() => idp.issueAuthorizationCode(SAML.name, 'nobody', 'c')).toThrow(
        expect.objectContaining({ code: 'user_not_found' }),
      );
    });

    it('keeps federated pool users apart from native users with the same email, and deleteUser removes them', async () => {
      idp.seedUsers([{ email: 'ana@acme.example', username: 'native-ana' }]);
      const code = idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER));
      const { idTokenClaims } = await idp.exchangeAuthorizationCode({ code, codeVerifier: VERIFIER, redirectUri: REDIRECT });

      await expect(idp.findUserByEmail('ana@acme.example')).resolves.toMatchObject({ username: 'native-ana' });

      await idp.deleteUser(idTokenClaims.username);
      await expect(idp.findUserByEmail('ana@acme.example')).resolves.toMatchObject({ username: 'native-ana' });
      // Cognito recreates the pool user (new sub) on the next federated sign-in.
      const next = await idp.exchangeAuthorizationCode({
        code: idp.issueAuthorizationCode(SAML.name, 'ana-nameid', s256(VERIFIER)),
        codeVerifier: VERIFIER,
        redirectUri: REDIRECT,
      });
      expect(next.idTokenClaims.sub).not.toBe(idTokenClaims.sub);
    });

    it('lists the seeded federated users of a provider', () => {
      expect(idp.listFederatedUsers(SAML.name).map((u) => u.email)).toEqual(['ana@acme.example', 'u@acme.example']);
      expect(idp.listFederatedUsers('other')).toEqual([]);
    });
  });
});
