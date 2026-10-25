/**
 * Cognito enterprise-SSO operations: identity-provider registration, the app
 * clients' `SupportedIdentityProviders`, the authorize URL and the
 * authorization-code exchange with ID-token verification.
 *
 * Free functions over `CognitoSsoConfig`, like cognito-user-ops.ts, so the
 * adapter class stays small.
 *
 * @see D-12, 3.4 Enterprise SSO
 */
import type { Jwks } from 'aws-jwt-verify/jwk';
import {
  FetchError,
  JwksNotAvailableInCacheError,
  JwksValidationError,
  JwtBaseError,
} from 'aws-jwt-verify/error';
import type {
  CognitoIdentityProviderClient,
  UserPoolClientType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  CreateIdentityProviderCommand,
  DeleteIdentityProviderCommand,
  DescribeIdentityProviderCommand,
  DescribeUserPoolClientCommand,
  ListIdentityProvidersCommand,
  UpdateIdentityProviderCommand,
  UpdateUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DEFAULT_SSO_SCOPES,
  IdentityProviderError,
} from './identity-provider.service.js';
import type {
  IdTokenClaims,
  ProviderInfo,
  ProviderInput,
  TokenSet,
} from './identity-provider.service.js';
import { mapCognitoError } from './cognito-error-map.js';
import { certificateExpiryFromMetadata } from './saml-metadata.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Verifies a Cognito ID token's signature, `iss`, `aud`, `token_use` and `exp`. */
export interface IdTokenVerifier {
  verify(idToken: string): Promise<Record<string, unknown>>;
}

export interface CognitoSsoConfig {
  client: CognitoIdentityProviderClient;
  userPoolId: string;
  webClientId: string;
  webClientSecret: string;
  mobileClientId: string;
  /** Hosted-UI domain without a trailing slash, e.g. `https://x.auth.eu-central-1.amazoncognito.com`. */
  domain: string;
  fetch: typeof fetch;
  idTokenVerifier: () => Promise<IdTokenVerifier>;
}

/**
 * aws-jwt-verify checks the RS256 signature against the pool JWKS (cached
 * per `kid`), `iss` (the pool), `aud` (the web client), `token_use = id` and
 * `exp`. Imported lazily so stub mode never loads it. `jwks` pre-loads the
 * key set instead of downloading it (tests).
 */
export async function createCognitoIdTokenVerifier(
  userPoolId: string,
  webClientId: string,
  jwks?: Jwks,
): Promise<IdTokenVerifier> {
  const { CognitoJwtVerifier } = await import('aws-jwt-verify');
  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId: webClientId,
  });
  if (jwks) verifier.cacheJwks(jwks);
  return {
    verify: async (token) => (await verifier.verify(token)) as unknown as Record<string, unknown>,
  };
}

/** Cognito's native provider; every client keeps it so email and password sign-in still work. */
const NATIVE_PROVIDER = 'COGNITO';

/** Defaults so the pool's `email` attribute is filled whatever the IdP sends. */
const DEFAULT_SAML_MAPPING: Record<string, string> = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
};
const DEFAULT_OIDC_MAPPING: Record<string, string> = {
  email: 'email',
  email_verified: 'email_verified',
};

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

function providerDetails(input: ProviderInput): Record<string, string> {
  if (input.protocol === 'SAML') {
    if (input.metadataUrl) return { MetadataURL: input.metadataUrl };
    if (input.metadataXml) return { MetadataFile: input.metadataXml };
    throw new IdentityProviderError('SAML provider needs metadata', 'not_authorized');
  }
  if (!input.oidcIssuer || !input.oidcClientId || !input.oidcClientSecret) {
    throw new IdentityProviderError(
      'OIDC provider needs issuer, client id and client secret',
      'not_authorized',
    );
  }
  return {
    client_id: input.oidcClientId,
    client_secret: input.oidcClientSecret,
    oidc_issuer: input.oidcIssuer,
    authorize_scopes: 'openid email profile',
    attributes_request_method: 'GET',
  };
}

function attributeMapping(input: ProviderInput): Record<string, string> {
  const defaults = input.protocol === 'SAML' ? DEFAULT_SAML_MAPPING : DEFAULT_OIDC_MAPPING;
  return { ...defaults, ...input.attributeMapping };
}

function isNotFound(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'ResourceNotFoundException';
}

/**
 * An SDK call on the identity provider itself: `ResourceNotFoundException`
 * means the provider is missing (`provider_not_found`). Mapped here, not in
 * the global error map, because elsewhere it means a missing pool or client.
 */
async function providerCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (isNotFound(err)) {
      throw new IdentityProviderError('Identity provider not found', 'provider_not_found');
    }
    mapCognitoError(err);
  }
}

/** An SDK call on the pool or an app client: a missing client is a deployment fault (`unavailable`). */
async function poolCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    mapCognitoError(err);
  }
}

/**
 * Cognito needs the OIDC client secret on every update. When the caller does
 * not pass a new one (it is write-only and NestSelf does not store it), keep
 * the one the pool already holds.
 */
async function withExistingOidcSecret(
  cfg: CognitoSsoConfig,
  input: ProviderInput,
): Promise<ProviderInput> {
  if (input.protocol !== 'OIDC' || input.oidcClientSecret) return input;
  const res = await providerCall(() =>
    cfg.client.send(
      new DescribeIdentityProviderCommand({
        UserPoolId: cfg.userPoolId,
        ProviderName: input.name,
      }),
    ),
  );
  const secret = res.IdentityProvider?.ProviderDetails?.['client_secret'];
  return secret ? { ...input, oidcClientSecret: secret } : input;
}

export async function cognitoCreateProvider(
  cfg: CognitoSsoConfig,
  input: ProviderInput,
): Promise<void> {
  const details = providerDetails(input);
  // DuplicateProviderException -> provider_exists (global map).
  await poolCall(() =>
    cfg.client.send(
      new CreateIdentityProviderCommand({
        UserPoolId: cfg.userPoolId,
        ProviderName: input.name,
        ProviderType: input.protocol,
        ProviderDetails: details,
        AttributeMapping: attributeMapping(input),
      }),
    ),
  );
  await setProviderOnClients(cfg, input.name, true);
}

export async function cognitoUpdateProvider(
  cfg: CognitoSsoConfig,
  input: ProviderInput,
): Promise<void> {
  const complete = await withExistingOidcSecret(cfg, input);
  const details = providerDetails(complete);
  await providerCall(() =>
    cfg.client.send(
      new UpdateIdentityProviderCommand({
        UserPoolId: cfg.userPoolId,
        ProviderName: input.name,
        ProviderDetails: details,
        AttributeMapping: attributeMapping(complete),
      }),
    ),
  );
  // Idempotent: repairs a client that lost the provider.
  await setProviderOnClients(cfg, input.name, true);
}

export async function cognitoDeleteProvider(
  cfg: CognitoSsoConfig,
  name: string,
): Promise<void> {
  // Clients first: Cognito refuses to delete a provider a client still lists.
  // A missing app client fails here (unavailable); it is not swallowed.
  await setProviderOnClients(cfg, name, false);
  try {
    await providerCall(() =>
      cfg.client.send(
        new DeleteIdentityProviderCommand({ UserPoolId: cfg.userPoolId, ProviderName: name }),
      ),
    );
  } catch (err) {
    // Already gone: deleting is idempotent.
    if (err instanceof IdentityProviderError && err.code === 'provider_not_found') return;
    throw err;
  }
}

export async function cognitoDescribeProvider(
  cfg: CognitoSsoConfig,
  name: string,
): Promise<ProviderInfo | null> {
  let res;
  try {
    res = await providerCall(() =>
      cfg.client.send(
        new DescribeIdentityProviderCommand({ UserPoolId: cfg.userPoolId, ProviderName: name }),
      ),
    );
  } catch (err) {
    if (err instanceof IdentityProviderError && err.code === 'provider_not_found') return null;
    throw err;
  }
  const idp = res.IdentityProvider;
  if (!idp) return null;
  const protocol = idp.ProviderType === 'SAML' ? 'SAML' : 'OIDC';
  return {
    name: idp.ProviderName ?? name,
    protocol,
    certificateExpiresAt:
      protocol === 'SAML'
        ? certificateExpiryFromMetadata(idp.ProviderDetails?.['MetadataFile'])
        : null,
  };
}

export async function cognitoListProviders(cfg: CognitoSsoConfig): Promise<string[]> {
  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const res = await poolCall(() =>
      cfg.client.send(
        new ListIdentityProvidersCommand({
          UserPoolId: cfg.userPoolId,
          MaxResults: 60,
          NextToken: nextToken,
        }),
      ),
    );
    for (const p of res.Providers ?? []) {
      if (p.ProviderName) names.push(p.ProviderName);
    }
    nextToken = res.NextToken ?? undefined;
  } while (nextToken);
  return names;
}

// ---------------------------------------------------------------------------
// App clients
// ---------------------------------------------------------------------------

/**
 * Every writable field of the client, read back so `UpdateUserPoolClient`
 * (which resets omitted fields to defaults) changes nothing but the list.
 */
function updatableClientFields(client: UserPoolClientType) {
  return {
    ClientName: client.ClientName,
    RefreshTokenValidity: client.RefreshTokenValidity,
    AccessTokenValidity: client.AccessTokenValidity,
    IdTokenValidity: client.IdTokenValidity,
    TokenValidityUnits: client.TokenValidityUnits,
    ReadAttributes: client.ReadAttributes,
    WriteAttributes: client.WriteAttributes,
    ExplicitAuthFlows: client.ExplicitAuthFlows,
    CallbackURLs: client.CallbackURLs,
    LogoutURLs: client.LogoutURLs,
    DefaultRedirectURI: client.DefaultRedirectURI,
    AllowedOAuthFlows: client.AllowedOAuthFlows,
    AllowedOAuthScopes: client.AllowedOAuthScopes,
    AllowedOAuthFlowsUserPoolClient: client.AllowedOAuthFlowsUserPoolClient,
    AnalyticsConfiguration: client.AnalyticsConfiguration,
    PreventUserExistenceErrors: client.PreventUserExistenceErrors,
    EnableTokenRevocation: client.EnableTokenRevocation,
    EnablePropagateAdditionalUserContextData: client.EnablePropagateAdditionalUserContextData,
    AuthSessionValidity: client.AuthSessionValidity,
    RefreshTokenRotation: client.RefreshTokenRotation,
  };
}

async function setProviderOnClient(
  cfg: CognitoSsoConfig,
  clientId: string,
  providerName: string,
  present: boolean,
): Promise<void> {
  const res = await poolCall(() =>
    cfg.client.send(
      new DescribeUserPoolClientCommand({ UserPoolId: cfg.userPoolId, ClientId: clientId }),
    ),
  );
  const client = res.UserPoolClient;
  if (!client) {
    throw new IdentityProviderError(`App client ${clientId} not found`, 'unavailable', true);
  }
  const current = client.SupportedIdentityProviders ?? [];
  const others = current.filter((p) => p !== providerName && p !== NATIVE_PROVIDER);
  const next = [NATIVE_PROVIDER, ...others, ...(present ? [providerName] : [])];
  const unchanged =
    next.length === current.length && next.every((p) => current.includes(p));
  if (unchanged) return;

  await poolCall(() =>
    cfg.client.send(
      new UpdateUserPoolClientCommand({
        ...updatableClientFields(client),
        UserPoolId: cfg.userPoolId,
        ClientId: clientId,
        SupportedIdentityProviders: next,
      }),
    ),
  );
}

async function setProviderOnClients(
  cfg: CognitoSsoConfig,
  providerName: string,
  present: boolean,
): Promise<void> {
  for (const clientId of [cfg.webClientId, cfg.mobileClientId]) {
    await setProviderOnClient(cfg, clientId, providerName, present);
  }
}

// ---------------------------------------------------------------------------
// Authorization-code flow
// ---------------------------------------------------------------------------

export function cognitoBuildAuthorizeUrl(
  cfg: Pick<CognitoSsoConfig, 'domain' | 'webClientId'>,
  input: {
    providerName: string;
    state: string;
    codeChallenge: string;
    redirectUri: string;
    surfaceScopes?: readonly string[];
  },
): string {
  const params = new URLSearchParams({
    identity_provider: input.providerName,
    response_type: 'code',
    client_id: cfg.webClientId,
    redirect_uri: input.redirectUri,
    scope: (input.surfaceScopes ?? DEFAULT_SSO_SCOPES).join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${cfg.domain}/oauth2/authorize?${params.toString()}`;
}

function parseIdentities(raw: unknown): IdTokenClaims['identities'] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (i): i is { providerName: string; userId: string } =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as { providerName?: unknown }).providerName === 'string' &&
        typeof (i as { userId?: unknown }).userId === 'string',
    )
    .map((i) => ({ providerName: i.providerName, userId: i.userId }));
}

function parseEmailVerified(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

/** Normalise verified Cognito ID-token claims. */
export function toIdTokenClaims(claims: Record<string, unknown>): IdTokenClaims {
  return {
    sub: String(claims['sub'] ?? ''),
    email: typeof claims['email'] === 'string' ? claims['email'] : '',
    emailVerified: parseEmailVerified(claims['email_verified']),
    identities: parseIdentities(claims['identities']),
    username: String(claims['cognito:username'] ?? ''),
    authTime: typeof claims['auth_time'] === 'number' ? claims['auth_time'] : 0,
  };
}

/** Abort the token request after this long; the caller sees `unavailable` (retryable). */
export const TOKEN_ENDPOINT_TIMEOUT_MS = 10_000;

/**
 * A JWKS that could not be fetched or is not cached is our outage
 * (`unavailable`, retryable); a token whose signature or claims fail is
 * the caller's (`not_authorized`). Errors outside aws-jwt-verify (network,
 * module load) are outages too.
 */
export function classifyIdTokenError(err: unknown): IdentityProviderError {
  if (err instanceof IdentityProviderError) return err;
  const outage =
    err instanceof FetchError ||
    err instanceof JwksNotAvailableInCacheError ||
    err instanceof JwksValidationError ||
    !(err instanceof JwtBaseError);
  return outage
    ? new IdentityProviderError('Pool signing keys unavailable', 'unavailable', true)
    : new IdentityProviderError('ID token failed verification', 'not_authorized');
}

interface TokenEndpointResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

export async function cognitoExchangeAuthorizationCode(
  cfg: CognitoSsoConfig,
  input: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenSet & { idTokenClaims: IdTokenClaims }> {
  const basic = Buffer.from(`${cfg.webClientId}:${cfg.webClientSecret}`).toString('base64');
  let res: Response;
  try {
    res = await cfg.fetch(`${cfg.domain}/oauth2/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(TOKEN_ENDPOINT_TIMEOUT_MS),
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.webClientId,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }).toString(),
    });
  } catch {
    // Network failure, or the timeout aborted the request (AbortError / TimeoutError).
    throw new IdentityProviderError('Token endpoint unreachable', 'unavailable', true);
  }

  let body: TokenEndpointResponse = {};
  try {
    body = (await res.json()) as TokenEndpointResponse;
  } catch {
    // Non-JSON body: treated below by status.
  }

  if (!res.ok) {
    if (body.error === 'invalid_grant') {
      throw new IdentityProviderError('Authorization code rejected', 'invalid_code');
    }
    throw new IdentityProviderError(
      `Token endpoint error ${res.status}`,
      'unavailable',
      res.status >= 500,
    );
  }
  if (!body.access_token || !body.id_token) {
    throw new IdentityProviderError('Token endpoint returned no tokens', 'unavailable', true);
  }

  let claims: Record<string, unknown>;
  try {
    const verifier = await cfg.idTokenVerifier();
    claims = await verifier.verify(body.id_token);
  } catch (err) {
    throw classifyIdTokenError(err);
  }

  return {
    accessToken: body.access_token,
    idToken: body.id_token,
    refreshToken: body.refresh_token ?? null,
    expiresIn: body.expires_in ?? 900,
    idTokenClaims: toIdTokenClaims(claims),
  };
}
