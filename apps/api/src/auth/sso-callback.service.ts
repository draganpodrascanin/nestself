/**
 * SsoCallbackService -- the SP-initiated federated sign-in (3.6 "SSO
 * redirect", API-R-06, API-R-07) and identity resolution per D-04 (3.4.5).
 *
 * `start`: PKCE S256 verifier/challenge and a 32-byte state; the record
 * `{ verifier, surface, returnPath, connection, test }` lives at
 * `pkce:{state}` for `PKCE_TTL`; the browser goes to the identity
 * provider's authorize URL.
 *
 * `callback`: the record is taken with GETDEL (a replayed or unknown state
 * finds nothing: Review Focus 1), the code is exchanged with the verifier,
 * and the federated identity is resolved:
 *   1. an existing `external_identities(cognito:<providerName>, sub)` signs
 *      in whatever the connection's status (Review Focus 4);
 *   2. new bindings need the connection ACTIVE, or TESTING on a staff test
 *      sign-in (`test=1`), and a verified email (SSO-R-08: OIDC
 *      `email_verified === true`; SAML also when the email's domain is a
 *      verified domain of that connection);
 *   3. a pending invitation of the connection's organization (Review Focus 2)
 *      for the same email (lowercased, trimmed, timing-safe: SSO-R-09) binds
 *      and activates the membership;
 *   4. else JIT when the connection enables it and the domain is verified
 *      for it: user (reused by email), ACTIVE membership in the default unit
 *      with the `employee` grant;
 *   5. else denied: the orphan federated pool user is deleted (SSO-R-10),
 *      `identity.denied`, neutral `/sign-in?reason=sso_denied`.
 * An unverified email binds nothing either: the orphan is deleted too (the
 * IdP recreates it on the next sign-in, so nothing is lost and no unbound
 * pool user lingers) and the user lands on `/sign-in?reason=sso_email_unverified`
 * to continue with the email code.
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
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import {
  IdentityProviderError,
  IdentityProviderService,
  type IdTokenClaims,
  type TokenSet,
} from '../identity/identity-provider.service.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { PKCE_TTL, pkceKey } from '../redis/redis-keys.js';
import { DbService, type DbExecutor } from '../db/db.service.js';
import { SsoRepository, type SsoConnectionRow } from '../db/repositories/sso.repository.js';
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { InvitationsRepository } from '../db/repositories/invitations.repository.js';
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import {
  InvitationMembershipActivator,
  JIT_TEMPLATE_KEY,
  invitableTemplateFor,
} from '../invitations/invitation-membership-activator.js';
import { IdentityResolutionService, federatedProvider } from './identity-resolution.service.js';
import { apiPublicUrlFrom } from './sso-start-url.js';

export type Surface = 'workspace' | 'admin';
export type RequestMeta = { ip: string | null; userAgent: string | null };

/** What `pkce:{state}` holds. Never logged or audited. */
export interface PkceRecord {
  verifier: string;
  surface: Surface;
  returnPath: string | null;
  connection: string;
  test: boolean;
}

export interface SsoRedirect {
  location: string;
  /** Set on a successful callback: the controller writes the cookies. */
  session?: { sessionId: string; csrfToken: string; absoluteExpiresAt: Date };
}

const DEFAULT_SURFACE_URLS: Record<Surface, string> = {
  workspace: 'http://localhost:5173',
  admin: 'http://localhost:5174',
};

const JIT_TEMPLATE = PERMISSION_TEMPLATES.find((t) => t.key === JIT_TEMPLATE_KEY)!;

/** PKCE S256: base64url(SHA-256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** SSO-R-09: lowercased, trimmed, timing-safe. */
export function sameEmail(a: string, b: string): boolean {
  const x = createHash('sha256').update(a.trim().toLowerCase()).digest();
  const y = createHash('sha256').update(b.trim().toLowerCase()).digest();
  return timingSafeEqual(x, y);
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

function parseRecord(raw: string | null): PkceRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<PkceRecord>;
    if (typeof r.verifier !== 'string' || typeof r.connection !== 'string') return null;
    if (r.surface !== 'workspace' && r.surface !== 'admin') return null;
    return {
      verifier: r.verifier,
      surface: r.surface,
      returnPath: typeof r.returnPath === 'string' ? r.returnPath : null,
      connection: r.connection,
      test: r.test === true,
    };
  } catch {
    return null;
  }
}

type Binding = { kind: 'invitation'; userId: string; invitationId: string; templateKey: string | null } | { kind: 'jit'; userId: string };

@Injectable()
export class SsoCallbackService {
  private readonly logger = new Logger(SsoCallbackService.name);

  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(forwardRef(() => DbService)) private readonly dbs: DbService,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => InvitationsRepository)) private readonly invitations: InvitationsRepository,
    @Inject(forwardRef(() => InvitationMembershipActivator)) private readonly activator: InvitationMembershipActivator,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identity: IdentityResolutionService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /** `${API_PUBLIC_URL}/api/auth/sso/callback`, registered on the web client. */
  callbackUrl(): string {
    return `${apiPublicUrlFrom(this.config.get<string>('API_PUBLIC_URL'))}/api/auth/sso/callback`;
  }

  surfaceOrigin(surface: Surface): string {
    const configured = this.config.get<string>(surface === 'admin' ? 'ADMIN_URL' : 'WORKSPACE_URL');
    return (configured || DEFAULT_SURFACE_URLS[surface]).replace(/\/+$/, '');
  }

  // -------------------------------------------------------------------------
  // GET /auth/sso/start
  // -------------------------------------------------------------------------

  async start(query: SsoStartQuery, meta: RequestMeta): Promise<SsoRedirect> {
    const test = query.test === '1';
    const connection = await this.sso.findConnectionByProviderName(query.connection);
    const usable =
      connection && (connection.status === 'ACTIVE' || (test && connection.status === 'TESTING'));
    if (!usable) {
      this.auditFailed('sso_connection', meta, connection);
      return { location: this.signInUrl(query.surface, 'sso_denied') };
    }

    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const record: PkceRecord = {
      verifier,
      surface: query.surface,
      returnPath: query.returnPath ?? null,
      connection: connection.cognitoProviderName,
      test,
    };
    await this.store.set(pkceKey(state), JSON.stringify(record), { ttlSeconds: PKCE_TTL });

    return {
      location: this.idp.buildAuthorizeUrl({
        providerName: connection.cognitoProviderName,
        state,
        codeChallenge: pkceChallenge(verifier),
        redirectUri: this.callbackUrl(),
      }),
    };
  }

  // -------------------------------------------------------------------------
  // GET /auth/sso/callback
  // -------------------------------------------------------------------------

  async callback(query: SsoCallbackQuery, meta: RequestMeta): Promise<SsoRedirect> {
    // Single use: GETDEL, so a replayed state finds nothing (Review Focus 1).
    const record = query.state ? parseRecord(await this.store.getDel(pkceKey(query.state))) : null;
    if (!record) {
      this.auditFailed('sso_state', meta, null);
      return { location: this.signInUrl('workspace', 'sso_denied') };
    }
    const deny = () => ({ location: this.signInUrl(record.surface, 'sso_denied') });

    if (query.error || !query.code) {
      this.auditFailed('sso_idp_error', meta, null, record.connection);
      return deny();
    }

    let exchanged: TokenSet & { idTokenClaims: IdTokenClaims };
    try {
      exchanged = await this.idp.exchangeAuthorizationCode({
        code: query.code,
        codeVerifier: record.verifier,
        redirectUri: this.callbackUrl(),
      });
    } catch (err) {
      if (!(err instanceof IdentityProviderError)) throw err;
      this.logger.warn(`SSO code exchange failed (${err.code})`);
      this.auditFailed('sso_exchange', meta, null, record.connection);
      return deny();
    }

    const claims = exchanged.idTokenClaims;
    const providerName = claims.identities?.[0]?.providerName ?? null;
    // The code must come from the provider this flow started with.
    if (!providerName || providerName !== record.connection) {
      this.auditFailed('sso_provider_mismatch', meta, null, record.connection);
      return deny();
    }

    const email = claims.email.trim().toLowerCase();
    const provider = federatedProvider(providerName);
    const connection = await this.sso.findConnectionByProviderName(providerName);

    // 1. Existing identity: signs in whatever the connection's status.
    const existing = await this.identities.findExternalIdentity(provider, claims.sub);
    if (existing) {
      return this.signIn(exchanged, email, record, connection, meta);
    }

    // 2. New bindings need a usable connection and a verified email.
    const usable =
      connection && (connection.status === 'ACTIVE' || (record.test && connection.status === 'TESTING'));
    if (!usable) {
      await this.denyBinding(claims, email, connection, meta, 'connection_inactive');
      return deny();
    }

    const domainVerified = await this.isDomainVerifiedFor(connection, domainOf(email));
    const emailVerified =
      claims.emailVerified === true || (connection.protocol === 'SAML' && domainVerified);
    if (!emailVerified) {
      await this.denyBinding(claims, email, connection, meta, 'email_unverified');
      return { location: this.signInUrl(record.surface, 'sso_email_unverified', email) };
    }

    // 3-4. Invitation or JIT, in one transaction of the connection's tenant.
    let binding: Binding | null;
    try {
      binding = await this.dbs.withOrgScope(connection.orgId, (tx) =>
        this.bind(tx, connection, claims, email, provider, domainVerified),
      );
    } catch (err) {
      this.logger.error(`SSO identity binding failed: ${(err as Error).message}`);
      this.auditFailed('sso_binding', meta, connection);
      return deny();
    }

    // 5. Nothing to bind to.
    if (!binding) {
      await this.denyBinding(claims, email, connection, meta, 'no_invitation');
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

    return this.signIn(exchanged, email, record, connection, meta);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async bind(
    tx: DbExecutor,
    connection: SsoConnectionRow,
    claims: IdTokenClaims,
    email: string,
    provider: string,
    domainVerified: boolean,
  ): Promise<Binding | null> {
    const now = new Date();

    // Only the connection's organization (Review Focus 2): the lookup is
    // scoped to it and RLS keeps other tenants' invitations out of reach.
    const invitation = await this.invitations.findPendingByEmailAndOrg(email, connection.orgId, now, tx);
    const template = invitation ? invitableTemplateFor(invitation) : null;
    if (invitation && template && invitation.orgId === connection.orgId && sameEmail(invitation.email, email)) {
      const userId = await this.resolveOrCreateUser(email, connection, tx, 'sso_invitation');
      await this.linkIdentity(tx, userId, claims, email, provider, connection, 'invitation');
      await this.activator.activateInvitationForUser(invitation, template, userId, now, tx);
      return { kind: 'invitation', userId, invitationId: invitation.id, templateKey: invitation.templateKey };
    }

    if (connection.jitProvisioning && domainVerified) {
      const userId = await this.resolveOrCreateUser(email, connection, tx, 'sso_jit');
      await this.audit.record({
        action: 'identity.created',
        actorUserId: null,
        actorKind: 'SYSTEM',
        orgId: connection.orgId,
        recordType: 'external_identity',
        recordId: userId,
        result: 'ALLOWED',
        details: { emailNormalised: email, provider, via: 'sso_jit', connectionId: connection.id },
      });
      await this.linkIdentity(tx, userId, claims, email, provider, connection, 'jit');
      await this.activator.activateMembership(
        {
          userId,
          orgId: connection.orgId,
          orgUnitId: connection.defaultOrgUnitId,
          template: JIT_TEMPLATE,
          // No inviter: the grant is recorded as the provisioned user's own,
          // the audit row says it came from the connection.
          grantedByUserId: userId,
          emailNormalised: email,
          now,
          details: { via: 'sso_jit', connectionId: connection.id },
        },
        tx,
      );
      return { kind: 'jit', userId };
    }

    return null;
  }

  private async resolveOrCreateUser(
    email: string,
    connection: SsoConnectionRow,
    tx: DbExecutor,
    via: string,
  ): Promise<string> {
    const existing = await this.identities.findUserByEmail(email, tx);
    if (existing) return existing.id;
    const user = await this.identities.createUser(
      {
        email,
        displayName: email.split('@')[0] ?? email,
        locale: 'sr-Latn',
        emailVerifiedAt: new Date(),
      },
      tx,
    );
    await this.audit.record({
      action: 'user.created',
      actorUserId: null,
      actorKind: 'SYSTEM',
      orgId: connection.orgId,
      recordType: 'user',
      recordId: user.id,
      result: 'ALLOWED',
      details: { emailNormalised: email, via, connectionId: connection.id },
    });
    return user.id;
  }

  private async linkIdentity(
    tx: DbExecutor,
    userId: string,
    claims: IdTokenClaims,
    email: string,
    provider: string,
    connection: SsoConnectionRow,
    via: 'invitation' | 'jit',
  ): Promise<void> {
    await this.identities.createExternalIdentity(
      {
        userId,
        provider,
        subject: claims.sub,
        cognitoUsername: claims.username,
        email,
        emailVerified: true,
        lastSeenAt: new Date(),
      },
      tx,
    );
    await this.audit.record({
      action: 'identity.linked',
      actorUserId: null,
      actorKind: 'SYSTEM',
      orgId: connection.orgId,
      recordType: 'external_identity',
      recordId: userId,
      result: 'ALLOWED',
      details: { emailNormalised: email, provider, via: `sso_${via}`, connectionId: connection.id },
    });
  }

  /** The email's domain is a verified domain of this connection. */
  private async isDomainVerifiedFor(connection: SsoConnectionRow, domain: string): Promise<boolean> {
    const row = await this.sso.findDomainByName(domain);
    return !!row && row.connectionId === connection.id && row.verifiedAt !== null;
  }

  private async signIn(
    exchanged: TokenSet & { idTokenClaims: IdTokenClaims },
    email: string,
    record: PkceRecord,
    connection: SsoConnectionRow | null,
    meta: RequestMeta,
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
      this.auditFailed('sso_session', meta, connection, record.connection);
      return { location: this.signInUrl(record.surface, 'sso_denied') };
    }

    if (record.test && connection?.status === 'TESTING') {
      await this.dbs.withOrgScope(connection.orgId, (tx) =>
        this.sso.updateConnection(connection.id, { lastTestedAt: new Date() }, tx, { fromStatus: 'TESTING' }),
      );
    }

    return {
      location: `${this.surfaceOrigin(record.surface)}${record.returnPath ?? '/'}`,
      session: {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
    };
  }

  /** SSO-R-10: delete the orphan federated pool user, record `identity.denied`. */
  private async denyBinding(
    claims: IdTokenClaims,
    email: string,
    connection: SsoConnectionRow | null,
    meta: RequestMeta,
    reason: 'connection_inactive' | 'email_unverified' | 'no_invitation',
  ): Promise<void> {
    try {
      await this.idp.deleteUser(claims.username);
    } catch (err) {
      this.logger.warn(
        `Could not delete the orphan federated user (${err instanceof IdentityProviderError ? err.code : 'error'})`,
      );
    }
    await this.audit.record({
      action: 'identity.denied',
      actorUserId: null,
      actorKind: 'SYSTEM',
      orgId: connection?.orgId ?? null,
      recordType: 'external_identity',
      recordId: connection?.cognitoProviderName ?? 'unknown',
      result: 'DENIED',
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: {
        emailNormalised: email,
        reason,
        connectionId: connection?.id ?? null,
        emailVerifiedClaim: claims.emailVerified,
      },
    });
  }

  private auditFailed(
    reason: string,
    meta: RequestMeta,
    connection: SsoConnectionRow | null,
    providerName?: string,
  ): void {
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
    this.audit.record(event).catch(() => {});
  }

  private signInUrl(surface: Surface, reason: SsoSignInReason, email?: string): string {
    const query = new URLSearchParams({ reason });
    if (email) query.set('email', email);
    return `${this.surfaceOrigin(surface)}/sign-in?${query.toString()}`;
  }
}
