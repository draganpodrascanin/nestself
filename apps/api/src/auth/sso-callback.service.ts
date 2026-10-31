/**
 * SsoCallbackService -- the SP-initiated federated sign-in (3.6 "SSO
 * redirect", API-R-06, API-R-07) and identity resolution per D-04 (3.4.5).
 *
 * `start`: PKCE S256 verifier/challenge and a 32-byte state; the record
 * `{ verifier, surface, returnPath, connection, test }` lives at
 * `pkce:{state}` for `PKCE_TTL`; the browser goes to the identity
 * provider's authorize URL.
 *
 * `start` also sets a browser-binding nonce (cookie, its hash in the record);
 * the callback refuses a request without the matching cookie (login CSRF).
 *
 * `callback`: the record is taken with GETDEL (a replayed or unknown state
 * finds nothing: Review Focus 1), the code is exchanged with the verifier,
 * and the federated identity is resolved:
 *   1. an existing `external_identities(cognito:<providerName>, sub)` signs
 *      in whatever the connection's status (Review Focus 4), provided the
 *      connection owning that provider name still exists, the identity was
 *      bound through that very connection (`ssoConnectionId`; null matches
 *      none) and the identity's user has an ACTIVE membership in the
 *      connection's organization: a provider name reused by another
 *      organization would otherwise hand it the first organization's pool
 *      users (Cognito keeps them, with their `sub`). A mismatch is the
 *      neutral `sso_denied`, audited as
 *      `auth.sign_in.failed { reason: 'sso_provider_mismatch' }`, and the
 *      pool user is not deleted (it is not an orphan);
 *   2. new bindings need the connection ACTIVE, or TESTING on a staff test
 *      sign-in (`test=<nonce>` from `POST /ops/sso-connections/:id/test`,
 *      single use), and a verified email: the email's domain is a verified
 *      domain of that connection, and for OIDC also `email_verified === true`
 *      (SSO-R-08; SAML relies on the domain inference);
 *   3. a pending invitation of the connection's organization (Review Focus 2)
 *      for the same email (lowercased, trimmed, timing-safe: SSO-R-09) binds
 *      and activates the membership;
 *   4. else JIT when the connection is ACTIVE (never while TESTING), enables
 *      it and the domain is verified for it: user (reused by email), ACTIVE membership in the default unit
 *      with the `employee` grant;
 *   5. else denied: the orphan federated pool user is deleted (SSO-R-10),
 *      `identity.denied`, neutral `/sign-in?reason=sso_denied`.
 * Paths 3 to 5 and the checks around them live in `FederatedBindingService`.
 * An address outside the connection's verified domains binds nothing: the
 * orphan is deleted and the user gets the neutral `/sign-in?reason=sso_denied`
 * (the connection does not vouch for that address at all, so the email-code
 * prefill would be wrong). An on-domain OIDC address without
 * `email_verified === true` binds nothing either: the orphan is deleted too
 * (the IdP recreates it on the next sign-in, so nothing is lost and no
 * unbound pool user lingers) and the user lands on
 * `/sign-in?reason=sso_email_unverified` to continue with the email code.
 *
 * Success creates the session (`auth.method = 'sso'`, `secondFactor = true`:
 * MFA is delegated to the IdP, 3.4.9) and redirects to the surface origin
 * plus the validated return path. Audit details never carry tokens, the
 * code, the verifier or the state.
 *
 * @see D-04, D-06, D-12, SSO-R-08..11, API-R-06, API-R-07
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SsoCallbackQuery, SsoSignInReason, SsoStartQuery } from '@nestself/contracts';
import {
  IdentityProviderError,
  IdentityProviderService,
  type IdTokenClaims,
  type TokenSet,
} from '../identity/identity-provider.service.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { PKCE_TTL, pkceKey, ssoTestKey } from '../redis/redis-keys.js';
import { DbService } from '../db/db.service.js';
import { SsoRepository, type SsoConnectionRow } from '../db/repositories/sso.repository.js';
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import { IdentityResolutionService, federatedProvider } from './identity-resolution.service.js';
import {
  FederatedBindingService,
  domainOf,
  type Binding,
  type RequestMeta,
} from './federated-binding.service.js';
import { ssoCallbackUrl, surfaceOrigin } from './sso-start-url.js';

export type Surface = 'workspace' | 'admin';

/** What `pkce:{state}` holds. Never logged or audited. */
export interface PkceRecord {
  verifier: string;
  surface: Surface;
  returnPath: string | null;
  connection: string;
  /** The single-use `sso_test:{nonce}` of a staff test sign-in, else null. */
  testNonce: string | null;
  /** SHA-256 (hex) of the browser-binding cookie set at start (login CSRF). */
  browserNonceHash: string;
}

export interface SsoRedirect {
  location: string;
  /** Set on a successful callback: the controller writes the cookies. */
  session?: { sessionId: string; csrfToken: string; absoluteExpiresAt: Date };
  /** Set by `start`: the controller writes it as the SSO browser-binding cookie. */
  browserNonce?: string;
}

/** PKCE S256: base64url(SHA-256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Timing-safe: the cookie's hash against the one stored at start. */
function browserNonceMatches(nonce: string | null, expectedHash: string): boolean {
  if (!nonce) return false;
  const actual = Buffer.from(sha256Hex(nonce), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseRecord(raw: string | null): PkceRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<PkceRecord>;
    if (typeof r.verifier !== 'string' || typeof r.connection !== 'string') return null;
    if (r.surface !== 'workspace' && r.surface !== 'admin') return null;
    if (typeof r.browserNonceHash !== 'string') return null;
    return {
      verifier: r.verifier,
      surface: r.surface,
      returnPath: typeof r.returnPath === 'string' ? r.returnPath : null,
      connection: r.connection,
      testNonce: typeof r.testNonce === 'string' ? r.testNonce : null,
      browserNonceHash: r.browserNonceHash,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class SsoCallbackService {
  private readonly logger = new Logger(SsoCallbackService.name);

  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(forwardRef(() => DbService)) private readonly dbs: DbService,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => FederatedBindingService)) private readonly binding: FederatedBindingService,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identity: IdentityResolutionService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /**
   * `${apiOriginForSurface(surface)}/api/auth/sso/callback`: the surface's own
   * origin (its SPA proxies `/api`), so the host-only session cookie is set on
   * the host whose `/api/auth/me` reads it. Registered on the web client
   * (`webCallbackUrls`). Start sends it and the exchange repeats it.
   */
  callbackUrl(surface: Surface): string {
    return ssoCallbackUrl(this.config, surface);
  }

  // -------------------------------------------------------------------------
  // GET /auth/sso/start
  // -------------------------------------------------------------------------

  async start(query: SsoStartQuery, meta: RequestMeta): Promise<SsoRedirect> {
    const connection = await this.sso.findConnectionByProviderName(query.connection);
    if (!connection) {
      // Not audited: the row would name no tenant, and the start throttle
      // counts per connection value, so one client rotating made-up names
      // could write rows without bound. The schema bounds the value to
      // [A-Za-z0-9_-]{1,32}, so it is safe to log.
      this.logger.debug(`SSO start for unknown connection ${query.connection}: neutral redirect`);
      return { location: this.signInUrl(query.surface, 'sso_denied') };
    }
    let testNonce: string | null = null;
    let usable = connection.status === 'ACTIVE';
    if (connection.status === 'TESTING' && query.test) {
      // Only with the nonce `POST /ops/sso-connections/:id/test` issued for it.
      usable = await this.testNonceIsFor(query.test, connection.id);
      if (usable) testNonce = query.test;
    }
    if (!usable) {
      // An existing connection that is not usable (DRAFT, SUSPENDED, TESTING
      // without a valid nonce): audited for its organization.
      await this.auditFailed('sso_connection', meta, connection);
      return { location: this.signInUrl(query.surface, 'sso_denied') };
    }

    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const browserNonce = randomBytes(32).toString('base64url');
    const record: PkceRecord = {
      verifier,
      surface: query.surface,
      returnPath: query.returnPath ?? null,
      connection: connection.cognitoProviderName,
      testNonce,
      browserNonceHash: sha256Hex(browserNonce),
    };
    await this.store.set(pkceKey(state), JSON.stringify(record), { ttlSeconds: PKCE_TTL });

    return {
      browserNonce,
      location: this.idp.buildAuthorizeUrl({
        providerName: connection.cognitoProviderName,
        state,
        codeChallenge: pkceChallenge(verifier),
        redirectUri: this.callbackUrl(query.surface),
      }),
    };
  }

  // -------------------------------------------------------------------------
  // GET /auth/sso/callback
  // -------------------------------------------------------------------------

  async callback(
    query: SsoCallbackQuery,
    meta: RequestMeta,
    /** The SSO browser-binding cookie of this request (null when absent). */
    browserNonce: string | null,
  ): Promise<SsoRedirect> {
    // Single use: GETDEL, so a replayed state finds nothing (Review Focus 1).
    const record = query.state ? parseRecord(await this.store.getDel(pkceKey(query.state))) : null;
    if (!record) {
      await this.auditFailed('sso_state', meta, null);
      return { location: this.signInUrl('workspace', 'sso_denied') };
    }
    const deny = () => ({ location: this.signInUrl(record.surface, 'sso_denied') });

    // A test flow's nonce is spent by its first callback, whatever the outcome.
    const testConnectionId = record.testNonce ? await this.consumeTestNonce(record.testNonce) : null;

    // Login CSRF: the callback must reach the browser that started the flow.
    if (!browserNonceMatches(browserNonce, record.browserNonceHash)) {
      await this.auditFailed('sso_browser', meta, null, record.connection);
      return deny();
    }

    if (query.error || !query.code) {
      await this.auditFailed('sso_idp_error', meta, null, record.connection);
      return deny();
    }

    let exchanged: TokenSet & { idTokenClaims: IdTokenClaims };
    try {
      exchanged = await this.idp.exchangeAuthorizationCode({
        code: query.code,
        codeVerifier: record.verifier,
        // The same redirect URI `start` sent for this surface (Cognito checks it).
        redirectUri: this.callbackUrl(record.surface),
      });
    } catch (err) {
      if (!(err instanceof IdentityProviderError)) throw err;
      this.logger.warn(`SSO code exchange failed (${err.code})`);
      await this.auditFailed('sso_exchange', meta, null, record.connection);
      return deny();
    }

    const claims = exchanged.idTokenClaims;
    const providerName = claims.identities?.[0]?.providerName ?? null;
    // The code must come from the provider this flow started with.
    if (!providerName || providerName !== record.connection) {
      await this.auditFailed('sso_provider_mismatch', meta, null, record.connection);
      return deny();
    }

    const email = claims.email.trim().toLowerCase();
    const provider = federatedProvider(providerName);
    const connection = await this.sso.findConnectionByProviderName(providerName);

    // 1. Existing identity: signs in whatever the connection's status.
    const existing = await this.identities.findExternalIdentity(provider, claims.sub);
    if (existing) {
      // Defence in depth for the per-organization slug reservation: the
      // identity must have been bound through the connection that now owns
      // this provider name (a null binding matches none), and its user must
      // be an ACTIVE member of that connection's organization. Not an
      // orphan, so nothing is deleted.
      if (
        !connection ||
        existing.ssoConnectionId !== connection.id ||
        !(await this.binding.isMemberOf(existing.userId, connection.orgId))
      ) {
        await this.auditFailed('sso_provider_mismatch', meta, connection, record.connection);
        return deny();
      }
      return this.signIn(exchanged, email, record, connection, meta, testConnectionId);
    }

    // 2. New bindings need a usable connection and a verified email.
    const isTest = !!connection && testConnectionId === connection.id;
    const usable =
      connection && (connection.status === 'ACTIVE' || (isTest && connection.status === 'TESTING'));
    if (!usable) {
      await this.binding.denyBinding(claims, email, connection, meta, 'connection_inactive');
      return deny();
    }

    // SSO-R-08 plus the domain rule: a connection vouches only for addresses
    // of its own verified domains, so a tenant's IdP cannot assert someone
    // else's address and take over that user. OIDC must also assert
    // `email_verified`; SAML relies on the domain inference.
    const domainVerified = await this.binding.isDomainVerifiedFor(connection, domainOf(email));
    if (!domainVerified) {
      // Off-domain: the connection vouches for nothing here, a neutral denial.
      await this.binding.denyBinding(claims, email, connection, meta, 'email_off_domain');
      return deny();
    }
    if (connection.protocol === 'OIDC' && claims.emailVerified !== true) {
      await this.binding.denyBinding(claims, email, connection, meta, 'email_unverified');
      return { location: this.signInUrl(record.surface, 'sso_email_unverified', email) };
    }

    // 3-4. Invitation or JIT, in one transaction of the connection's tenant.
    let binding: Binding | null;
    try {
      binding = await this.dbs.withOrgScope(connection.orgId, (tx) =>
        this.binding.bind(tx, connection, claims, email, provider, domainVerified),
      );
    } catch (err) {
      this.logger.error(`SSO identity binding failed: ${(err as Error).message}`);
      await this.auditFailed('sso_binding', meta, connection);
      return deny();
    }

    // 5. Nothing to bind to.
    if (!binding) {
      await this.binding.denyBinding(claims, email, connection, meta, 'no_invitation');
      return deny();
    }

    if (binding.kind === 'invitation') {
      await this.audit.record({
        action: 'invitation.accepted',
        actorUserId: binding.userId,
        actorKind: 'USER',
        orgId: connection.orgId,
        recordType: 'invitation',
        recordId: binding.invitationId,
        result: 'ALLOWED',
        details: { emailNormalised: email, templateKey: binding.templateKey, via: 'sso', connectionId: connection.id },
      });
    }
    await this.principalLoader.invalidateUser(binding.userId, [connection.orgId]);

    return this.signIn(exchanged, email, record, connection, meta, testConnectionId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async testNonceIsFor(nonce: string, connectionId: string): Promise<boolean> {
    return this.parseTestRecord(await this.store.get(ssoTestKey(nonce))) === connectionId;
  }

  private async consumeTestNonce(nonce: string): Promise<string | null> {
    return this.parseTestRecord(await this.store.getDel(ssoTestKey(nonce)));
  }

  private parseTestRecord(raw: string | null): string | null {
    if (!raw) return null;
    try {
      const r = JSON.parse(raw) as { connectionId?: unknown };
      return typeof r.connectionId === 'string' ? r.connectionId : null;
    } catch {
      return null;
    }
  }

  private async signIn(
    exchanged: TokenSet & { idTokenClaims: IdTokenClaims },
    email: string,
    record: PkceRecord,
    connection: SsoConnectionRow | null,
    meta: RequestMeta,
    testConnectionId: string | null,
  ): Promise<SsoRedirect> {
    let session;
    try {
      session = await this.identity.resolveIdentityAndCreateSession(
        exchanged,
        email,
        record.surface,
        meta,
        false,
        true,
        record.connection,
      );
    } catch (err) {
      // A suspended or deactivated user, or an identity removed meanwhile.
      this.logger.warn(`SSO session creation refused: ${(err as Error).message}`);
      await this.auditFailed('sso_session', meta, connection, record.connection);
      return { location: this.signInUrl(record.surface, 'sso_denied') };
    }

    // Only a valid test flow that bound or signed in marks the connection tested.
    if (connection?.status === 'TESTING' && testConnectionId === connection.id) {
      await this.dbs.withOrgScope(connection.orgId, (tx) =>
        this.sso.updateConnection(connection.id, { lastTestedAt: new Date() }, tx, { fromStatus: 'TESTING' }),
      );
    }

    return {
      location: `${surfaceOrigin(this.config, record.surface)}${record.returnPath ?? '/'}`,
      session: {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
    };
  }

  /**
   * Awaited, so the row exists before the redirect leaves; a failed write is
   * swallowed (logged by the writer), because the redirect must still go out.
   */
  private async auditFailed(
    reason: string,
    meta: RequestMeta,
    connection: SsoConnectionRow | null,
    providerName?: string,
  ): Promise<void> {
    const event: AuditEventInput = {
      action: 'auth.sign_in.failed',
      actorUserId: null,
      actorKind: 'USER',
      orgId: connection?.orgId ?? null,
      recordType: 'auth_attempt',
      recordId: connection?.cognitoProviderName ?? providerName ?? 'sso',
      result: 'DENIED',
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { reason },
    };
    await this.audit.record(event).catch(() => {});
  }

  private signInUrl(surface: Surface, reason: SsoSignInReason, email?: string): string {
    const query = new URLSearchParams({ reason });
    if (email) query.set('email', email);
    return `${surfaceOrigin(this.config, surface)}/sign-in?${query.toString()}`;
  }
}
