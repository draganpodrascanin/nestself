import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { Jwks } from 'aws-jwt-verify/jwk';
import { IdentityProviderError } from './identity-provider.service.js';
import { SAMPLE_SAML_METADATA, SIGNING_CERT_NOT_AFTER } from './saml-metadata.fixture.js';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class MockClient {
    send = mockSend;
  }
  const command = () =>
    class {
      constructor(public input: unknown) {}
    };
  return {
    CognitoIdentityProviderClient: MockClient,
    AdminInitiateAuthCommand: command(),
    AdminRespondToAuthChallengeCommand: command(),
    GetTokensFromRefreshTokenCommand: command(),
    RevokeTokenCommand: command(),
    AdminUserGlobalSignOutCommand: command(),
    AdminCreateUserCommand: command(),
    AdminDeleteUserCommand: command(),
    AdminDisableUserCommand: command(),
    AdminEnableUserCommand: command(),
    AdminGetUserCommand: command(),
    ListUsersCommand: command(),
    AssociateSoftwareTokenCommand: command(),
    VerifySoftwareTokenCommand: command(),
    SetUserMFAPreferenceCommand: command(),
    ForgotPasswordCommand: command(),
    ConfirmForgotPasswordCommand: command(),
    CreateIdentityProviderCommand: class CreateIdentityProviderCommand {
      constructor(public input: unknown) {}
    },
    UpdateIdentityProviderCommand: class UpdateIdentityProviderCommand {
      constructor(public input: unknown) {}
    },
    DeleteIdentityProviderCommand: class DeleteIdentityProviderCommand {
      constructor(public input: unknown) {}
    },
    DescribeIdentityProviderCommand: class DescribeIdentityProviderCommand {
      constructor(public input: unknown) {}
    },
    ListIdentityProvidersCommand: class ListIdentityProvidersCommand {
      constructor(public input: unknown) {}
    },
    DescribeUserPoolClientCommand: class DescribeUserPoolClientCommand {
      constructor(public input: unknown) {}
    },
    UpdateUserPoolClientCommand: class UpdateUserPoolClientCommand {
      constructor(public input: unknown) {}
    },
  };
});

const { CognitoIdentityProvider } = await import('./cognito-identity-provider.js');
const { classifyIdTokenError, TOKEN_ENDPOINT_TIMEOUT_MS } = await import('./cognito-sso-ops.js');
const jwtErrors = await import('aws-jwt-verify/error');

const REGION = 'eu-central-1';
const POOL_ID = 'eu-central-1_TEST';
const WEB_CLIENT = 'web-client-id';
const WEB_SECRET = 'web-client-secret';
const MOBILE_CLIENT = 'mobile-client-id';
const DOMAIN = 'https://nestself-test.auth.eu-central-1.amazoncognito.com';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
const KID = 'test-kid-1';

type Sent = { name: string; input: Record<string, unknown> };

function sentCommands(): Sent[] {
  return mockSend.mock.calls.map(([cmd]) => ({
    name: (cmd as { constructor: { name: string } }).constructor.name,
    input: (cmd as { input: Record<string, unknown> }).input,
  }));
}

/** A client as DescribeUserPoolClient returns it (fields the update must keep). */
function poolClient(clientId: string, providers: string[]) {
  return {
    UserPoolId: POOL_ID,
    ClientId: clientId,
    ClientName: `${clientId}-name`,
    ClientSecret: 'must-not-be-sent',
    CreationDate: new Date('2026-10-24T00:00:00Z'),
    LastModifiedDate: new Date('2026-10-24T00:00:00Z'),
    CallbackURLs: [`https://app.example/${clientId}/callback`],
    LogoutURLs: [`https://app.example/${clientId}/signed-out`],
    AllowedOAuthFlows: ['code'],
    AllowedOAuthScopes: ['openid', 'email', 'profile'],
    AllowedOAuthFlowsUserPoolClient: true,
    ExplicitAuthFlows: ['ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_USER_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
    TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'days' },
    AccessTokenValidity: 15,
    IdTokenValidity: 15,
    RefreshTokenValidity: 30,
    PreventUserExistenceErrors: 'ENABLED',
    EnableTokenRevocation: true,
    ReadAttributes: ['email', 'custom:locale'],
    WriteAttributes: ['custom:locale'],
    AuthSessionValidity: 3,
    SupportedIdentityProviders: providers,
  };
}

/** Route mocked SDK calls by command name; clients keep state across updates. */
function routeSdk(
  clients: Record<string, string[]>,
  overrides: Partial<Record<string, (input: Record<string, unknown>) => unknown>> = {},
) {
  mockSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name;
    const override = overrides[name];
    if (override) return override(cmd.input);
    if (name === 'DescribeUserPoolClientCommand') {
      const id = cmd.input['ClientId'] as string;
      return { UserPoolClient: poolClient(id, clients[id] ?? ['COGNITO']) };
    }
    if (name === 'UpdateUserPoolClientCommand') {
      clients[cmd.input['ClientId'] as string] = cmd.input['SupportedIdentityProviders'] as string[];
      return {};
    }
    return {};
  });
}

// -- ID tokens ---------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { n, e } = publicKey.export({ format: 'jwk' });
const JWKS: Jwks = { keys: [{ kty: 'RSA', n: n!, e: e!, kid: KID, alg: 'RS256', use: 'sig' }] };

function signJwt(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

function idTokenClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'pool-sub-1',
    iss: ISSUER,
    aud: WEB_CLIENT,
    token_use: 'id',
    auth_time: now - 5,
    iat: now - 5,
    exp: now + 900,
    email: 'ana@acme.example',
    email_verified: 'true',
    'cognito:username': 'org-acme-saml_ana-nameid',
    identities: [
      {
        userId: 'ana-nameid',
        providerName: 'org-acme-saml',
        providerType: 'SAML',
        issuer: null,
        primary: 'true',
        dateCreated: String(now * 1000),
      },
    ],
    ...overrides,
  };
}

function tokenResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CognitoIdentityProvider: enterprise SSO', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let provider: InstanceType<typeof CognitoIdentityProvider>;

  beforeEach(() => {
    mockSend.mockReset();
    fetchMock.mockReset();
    provider = new CognitoIdentityProvider(
      REGION,
      POOL_ID,
      WEB_CLIENT,
      WEB_SECRET,
      MOBILE_CLIENT,
      `${DOMAIN}/`,
      { fetch: fetchMock, jwks: JWKS },
    );
  });

  describe('buildAuthorizeUrl', () => {
    it('targets the hosted domain with the provider, web client, PKCE S256 and default scopes', () => {
      const url = provider.buildAuthorizeUrl({
        providerName: 'org-acme-saml',
        state: 'state-123',
        codeChallenge: 'challenge-abc',
        redirectUri: 'https://api.example/api/auth/sso/callback',
      });
      expect(url).toBe(
        `${DOMAIN}/oauth2/authorize?identity_provider=org-acme-saml&response_type=code` +
          `&client_id=${WEB_CLIENT}&redirect_uri=https%3A%2F%2Fapi.example%2Fapi%2Fauth%2Fsso%2Fcallback` +
          '&scope=openid+email+profile&state=state-123&code_challenge=challenge-abc&code_challenge_method=S256',
      );
    });

    it('uses the scopes the caller narrows to', () => {
      const url = new URL(
        provider.buildAuthorizeUrl({
          providerName: 'p',
          state: 's',
          codeChallenge: 'c',
          redirectUri: 'https://r.example/cb',
          surfaceScopes: ['openid', 'email'],
        }),
      );
      expect(url.searchParams.get('scope')).toBe('openid email');
    });
  });

  describe('createProvider', () => {
    it('registers a SAML provider from metadata and lists it on both clients, keeping COGNITO and every client field', async () => {
      const clients: Record<string, string[]> = {
        [WEB_CLIENT]: ['COGNITO'],
        [MOBILE_CLIENT]: ['COGNITO', 'org-other-oidc'],
      };
      routeSdk(clients);

      await provider.createProvider({
        name: 'org-acme-saml',
        protocol: 'SAML',
        metadataXml: SAMPLE_SAML_METADATA,
        attributeMapping: { given_name: 'firstName' },
      });

      const sent = sentCommands();
      expect(sent[0]!.name).toBe('CreateIdentityProviderCommand');
      expect(sent[0]!.input).toEqual({
        UserPoolId: POOL_ID,
        ProviderName: 'org-acme-saml',
        ProviderType: 'SAML',
        ProviderDetails: { MetadataFile: SAMPLE_SAML_METADATA },
        AttributeMapping: {
          email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
          given_name: 'firstName',
        },
      });

      const updates = sent.filter((c) => c.name === 'UpdateUserPoolClientCommand');
      expect(updates.map((u) => u.input['ClientId'])).toEqual([WEB_CLIENT, MOBILE_CLIENT]);
      expect(clients[WEB_CLIENT]).toEqual(['COGNITO', 'org-acme-saml']);
      expect(clients[MOBILE_CLIENT]).toEqual(['COGNITO', 'org-other-oidc', 'org-acme-saml']);

      const web = updates[0]!.input;
      const { ClientSecret: _s, CreationDate: _c, LastModifiedDate: _l, SupportedIdentityProviders: _p, ...kept } =
        poolClient(WEB_CLIENT, []);
      expect(web).toMatchObject(kept);
      expect(web).not.toHaveProperty('ClientSecret');
      expect(web).not.toHaveProperty('CreationDate');
    });

    it('registers an OIDC provider with issuer, client id and secret', async () => {
      routeSdk({});
      await provider.createProvider({
        name: 'org-acme-oidc',
        protocol: 'OIDC',
        oidcIssuer: 'https://login.acme.example',
        oidcClientId: 'acme-client',
        oidcClientSecret: 'acme-secret',
        attributeMapping: {},
      });
      const create = sentCommands()[0]!;
      expect(create.input['ProviderType']).toBe('OIDC');
      expect(create.input['ProviderDetails']).toEqual({
        client_id: 'acme-client',
        client_secret: 'acme-secret',
        oidc_issuer: 'https://login.acme.example',
        authorize_scopes: 'openid email profile',
        attributes_request_method: 'GET',
      });
      expect(create.input['AttributeMapping']).toEqual({ email: 'email', email_verified: 'email_verified' });
    });

    it('does not update a client that already lists the provider', async () => {
      routeSdk({ [WEB_CLIENT]: ['COGNITO', 'org-acme-saml'], [MOBILE_CLIENT]: ['org-acme-saml', 'COGNITO'] });
      await provider.createProvider({
        name: 'org-acme-saml',
        protocol: 'SAML',
        metadataUrl: 'https://idp.acme.example/metadata',
        attributeMapping: {},
      });
      expect(sentCommands().filter((c) => c.name === 'UpdateUserPoolClientCommand')).toHaveLength(0);
      expect(sentCommands()[0]!.input['ProviderDetails']).toEqual({
        MetadataURL: 'https://idp.acme.example/metadata',
      });
    });

    it('maps DuplicateProviderException to provider_exists', async () => {
      const err = Object.assign(new Error('exists'), { name: 'DuplicateProviderException' });
      routeSdk({}, { CreateIdentityProviderCommand: () => Promise.reject(err) });
      await expect(
        provider.createProvider({ name: 'p', protocol: 'SAML', metadataUrl: 'https://m.example', attributeMapping: {} }),
      ).rejects.toMatchObject({ code: 'provider_exists' });
    });

    it('reports a missing app client after creation as unavailable, not provider_not_found', async () => {
      const err = Object.assign(new Error('client gone'), { name: 'ResourceNotFoundException' });
      routeSdk({}, { DescribeUserPoolClientCommand: () => Promise.reject(err) });
      await expect(
        provider.createProvider({ name: 'p', protocol: 'SAML', metadataUrl: 'https://m.example', attributeMapping: {} }),
      ).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('refuses an OIDC provider without a client secret before calling Cognito', async () => {
      routeSdk({});
      await expect(
        provider.createProvider({
          name: 'p',
          protocol: 'OIDC',
          oidcIssuer: 'https://i.example',
          oidcClientId: 'c',
          attributeMapping: {},
        }),
      ).rejects.toBeInstanceOf(IdentityProviderError);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('updateProvider', () => {
    it('keeps the stored OIDC client secret when no new one is given', async () => {
      routeSdk(
        { [WEB_CLIENT]: ['COGNITO', 'org-acme-oidc'], [MOBILE_CLIENT]: ['COGNITO', 'org-acme-oidc'] },
        {
          DescribeIdentityProviderCommand: () => ({
            IdentityProvider: { ProviderName: 'org-acme-oidc', ProviderType: 'OIDC', ProviderDetails: { client_secret: 'stored' } },
          }),
        },
      );
      await provider.updateProvider({
        name: 'org-acme-oidc',
        protocol: 'OIDC',
        oidcIssuer: 'https://login.acme.example/v2',
        oidcClientId: 'acme-client',
        attributeMapping: {},
      });
      const update = sentCommands().find((c) => c.name === 'UpdateIdentityProviderCommand')!;
      expect(update.input['ProviderDetails']).toMatchObject({
        client_secret: 'stored',
        oidc_issuer: 'https://login.acme.example/v2',
      });
    });

    it('maps ResourceNotFoundException to provider_not_found', async () => {
      const err = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
      routeSdk({}, { UpdateIdentityProviderCommand: () => Promise.reject(err) });
      await expect(
        provider.updateProvider({ name: 'p', protocol: 'SAML', metadataUrl: 'https://m.example', attributeMapping: {} }),
      ).rejects.toMatchObject({ code: 'provider_not_found' });
    });
  });

  describe('deleteProvider', () => {
    it('removes the provider from both clients before deleting it, keeping COGNITO', async () => {
      const clients: Record<string, string[]> = {
        [WEB_CLIENT]: ['COGNITO', 'org-acme-saml'],
        [MOBILE_CLIENT]: ['org-acme-saml', 'org-other-oidc'],
      };
      routeSdk(clients);
      await provider.deleteProvider('org-acme-saml');

      const names = sentCommands().map((c) => c.name);
      expect(names.at(-1)).toBe('DeleteIdentityProviderCommand');
      expect(names.indexOf('UpdateUserPoolClientCommand')).toBeLessThan(names.indexOf('DeleteIdentityProviderCommand'));
      expect(clients[WEB_CLIENT]).toEqual(['COGNITO']);
      expect(clients[MOBILE_CLIENT]).toEqual(['COGNITO', 'org-other-oidc']);
    });

    it('does not swallow a missing app client: fails unavailable and deletes nothing', async () => {
      const err = Object.assign(new Error('client gone'), { name: 'ResourceNotFoundException' });
      routeSdk({}, { DescribeUserPoolClientCommand: () => Promise.reject(err) });
      await expect(provider.deleteProvider('org-acme-saml')).rejects.toMatchObject({ code: 'unavailable' });
      expect(sentCommands().map((c) => c.name)).not.toContain('DeleteIdentityProviderCommand');
    });

    it('is idempotent when the provider is already gone', async () => {
      const err = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
      routeSdk({}, { DeleteIdentityProviderCommand: () => Promise.reject(err) });
      await expect(provider.deleteProvider('gone')).resolves.toBeUndefined();
    });
  });

  describe('describeProvider and listProviders', () => {
    it('reads the signing certificate expiry from SAML metadata', async () => {
      routeSdk({}, {
        DescribeIdentityProviderCommand: () => ({
          IdentityProvider: {
            ProviderName: 'org-acme-saml',
            ProviderType: 'SAML',
            ProviderDetails: { MetadataURL: 'https://m.example', MetadataFile: SAMPLE_SAML_METADATA },
          },
        }),
      });
      await expect(provider.describeProvider('org-acme-saml')).resolves.toEqual({
        name: 'org-acme-saml',
        protocol: 'SAML',
        certificateExpiresAt: SIGNING_CERT_NOT_AFTER,
      });
    });

    it('returns no certificate expiry for OIDC and null for an unknown provider', async () => {
      routeSdk({}, {
        DescribeIdentityProviderCommand: (input) => {
          if (input['ProviderName'] === 'missing') {
            return Promise.reject(Object.assign(new Error('x'), { name: 'ResourceNotFoundException' }));
          }
          return { IdentityProvider: { ProviderName: 'org-acme-oidc', ProviderType: 'OIDC', ProviderDetails: {} } };
        },
      });
      await expect(provider.describeProvider('org-acme-oidc')).resolves.toMatchObject({ certificateExpiresAt: null });
      await expect(provider.describeProvider('missing')).resolves.toBeNull();
    });

    it('follows NextToken across pages', async () => {
      routeSdk({}, {
        ListIdentityProvidersCommand: (input) =>
          input['NextToken'] === 'page-2'
            ? { Providers: [{ ProviderName: 'c' }] }
            : { Providers: [{ ProviderName: 'a' }, { ProviderName: 'b' }], NextToken: 'page-2' },
      });
      await expect(provider.listProviders()).resolves.toEqual(['a', 'b', 'c']);
      expect(sentCommands().filter((c) => c.name === 'ListIdentityProvidersCommand')).toHaveLength(2);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    const input = { code: 'auth-code', codeVerifier: 'verifier-xyz', redirectUri: 'https://api.example/cb' };

    it('posts the code and PKCE verifier with Basic client auth and returns verified, normalised claims', async () => {
      const claims = idTokenClaims();
      const idToken = signJwt(claims);
      fetchMock.mockResolvedValueOnce(
        tokenResponse(200, { access_token: 'at', id_token: idToken, refresh_token: 'rt', expires_in: 3600 }),
      );

      const result = await provider.exchangeAuthorizationCode(input);

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`${DOMAIN}/oauth2/token`);
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Basic ${Buffer.from(`${WEB_CLIENT}:${WEB_SECRET}`).toString('base64')}`);
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(init?.body as string);
      expect(Object.fromEntries(body)).toEqual({
        grant_type: 'authorization_code',
        client_id: WEB_CLIENT,
        code: 'auth-code',
        redirect_uri: 'https://api.example/cb',
        code_verifier: 'verifier-xyz',
      });

      expect(result).toMatchObject({ accessToken: 'at', idToken, refreshToken: 'rt', expiresIn: 3600 });
      expect(result.idTokenClaims).toEqual({
        sub: 'pool-sub-1',
        email: 'ana@acme.example',
        emailVerified: true,
        identities: [{ providerName: 'org-acme-saml', userId: 'ana-nameid' }],
        username: 'org-acme-saml_ana-nameid',
        authTime: claims.auth_time,
      });
    });

    it('reports a missing email_verified claim as null and a native user as having no identities', async () => {
      const claims: Record<string, unknown> = idTokenClaims();
      delete claims['email_verified'];
      delete claims['identities'];
      fetchMock.mockResolvedValueOnce(tokenResponse(200, { access_token: 'at', id_token: signJwt(claims) }));
      const result = await provider.exchangeAuthorizationCode(input);
      expect(result.idTokenClaims.emailVerified).toBeNull();
      expect(result.idTokenClaims.identities).toBeNull();
      expect(result.refreshToken).toBeNull();
    });

    it('aborts the token request after the timeout and reports it as retryable unavailable', async () => {
      fetchMock.mockImplementationOnce(async (_url, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        throw new DOMException('The operation timed out.', 'TimeoutError');
      });
      await expect(provider.exchangeAuthorizationCode(input)).rejects.toMatchObject({
        code: 'unavailable',
        retryable: true,
      });
      fetchMock.mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));
      await expect(provider.exchangeAuthorizationCode(input)).rejects.toMatchObject({ code: 'unavailable' });
      expect(TOKEN_ENDPOINT_TIMEOUT_MS).toBe(10_000);
    });

    it('maps invalid_grant to invalid_code', async () => {
      fetchMock.mockResolvedValueOnce(tokenResponse(400, { error: 'invalid_grant' }));
      await expect(provider.exchangeAuthorizationCode(input)).rejects.toMatchObject({ code: 'invalid_code' });
    });

    it('maps other token-endpoint failures and network errors to unavailable', async () => {
      fetchMock.mockResolvedValueOnce(tokenResponse(400, { error: 'invalid_client' }));
      await expect(provider.exchangeAuthorizationCode(input)).rejects.toMatchObject({ code: 'unavailable' });
      fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
      await expect(provider.exchangeAuthorizationCode(input)).rejects.toMatchObject({ code: 'unavailable', retryable: true });
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(provider.exchangeAuthorizationCode(input)).rejects.toMatchObject({ code: 'unavailable' });
    });

    it.each([
      ['a signature from another key', () => signJwt(idTokenClaims(), otherKeys.privateKey)],
      ['another issuer', () => signJwt(idTokenClaims({ iss: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_OTHER' }))],
      ['another audience (mobile client)', () => signJwt(idTokenClaims({ aud: MOBILE_CLIENT }))],
      ['an access token', () => signJwt(idTokenClaims({ token_use: 'access' }))],
      ['an expired token', () => signJwt(idTokenClaims({ exp: Math.floor(Date.now() / 1000) - 60 }))],
    ])('rejects an ID token with %s', async (_label, makeToken) => {
      fetchMock.mockResolvedValueOnce(tokenResponse(200, { access_token: 'at', id_token: makeToken() }));
      await expect(provider.exchangeAuthorizationCode(input)).rejects.toMatchObject({ code: 'not_authorized' });
    });
  });
});

describe('classifyIdTokenError', () => {
  it.each([
    ['a JWKS missing from the cache', new jwtErrors.JwksNotAvailableInCacheError('not cached')],
    ['a JWKS fetch failure', new jwtErrors.FetchError('https://cognito-idp.example/jwks.json', 'ECONNRESET')],
    ['a non-retryable JWKS fetch failure', new jwtErrors.NonRetryableFetchError('https://cognito-idp.example/jwks.json', '404')],
    ['a malformed JWKS', new jwtErrors.JwksValidationError('bad jwks')],
    ['a network error outside the library', new TypeError('fetch failed')],
  ])('treats %s as a retryable outage', (_label, err) => {
    expect(classifyIdTokenError(err)).toMatchObject({ code: 'unavailable', retryable: true });
  });

  it.each([
    ['an invalid signature', new jwtErrors.JwtInvalidSignatureError('bad sig')],
    ['an unparsable token', new jwtErrors.JwtParseError('bad jwt')],
    ['an unknown kid', new jwtErrors.KidNotFoundInJwksError('no kid')],
  ])('treats %s as not_authorized', (_label, err) => {
    expect(classifyIdTokenError(err)).toMatchObject({ code: 'not_authorized' });
  });
});
