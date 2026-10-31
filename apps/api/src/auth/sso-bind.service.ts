/**
 * SsoBindService: finishes a federated binding the callback could not finish
 * because the OIDC provider did not mark the address verified (SSO-R-08,
 * phase 4 design 5.6). The callback kept the pool user, stored a pending
 * binding (`PendingBindStore`) and sent the browser to
 * `/sign-in?reason=sso_email_unverified&bind=<handle>`; the sign-in page sends
 * the handle back here.
 *
 * - `start` mails a NestSelf code (`NestselfOtpService`, purpose `sso_bind`)
 *   to the asserted address and answers with the challenge token and the
 *   masked address. The pending binding stays: a code lives 5 minutes, the
 *   handle 15, so a user whose code expired asks for a new one from the same
 *   screen. An unknown or expired handle is 400 `invalid_challenge`.
 * - `verify` checks the code, then takes the pending binding (single use).
 *   An IdP account that has an identity by now (another tab or a retry bound
 *   it, or a direct sign-in after the claim switch went off) signs in through
 *   path 1 exactly as the callback runs it
 *   (`FederatedBindingService.existingIdentityUsable`); a refusal there is
 *   the neutral 403 `sso_denied` with
 *   `auth.sign_in.failed { reason: 'sso_provider_mismatch' }`, and that pool
 *   user is never deleted. Otherwise `verify` reloads the connection and
 *   binds exactly as the callback does
 *   (`FederatedBindingService`: an invitation of the connection's
 *   organization, else JIT, never JIT while TESTING), in that organization's
 *   transaction. The session is created from the token set of the original
 *   code exchange. The connection must be ACTIVE, or TESTING when a staff
 *   test sign-in opened the pending binding (`testSignIn`: its test link was
 *   valid); such a test that binds and signs in marks the connection tested,
 *   as the callback's test path does (Entra ID sends no `email_verified`, so
 *   a staff test against it can only finish here). A connection that no
 *   longer qualifies, has another provider name or no longer has the
 *   address's domain verified (Review Focus 2) binds nothing, and neither
 *   does a sign-in nothing can be bound to: the orphan pool user is deleted,
 *   `identity.denied` is recorded and the answer is 403 `sso_denied`.
 * - `resend` mails a new code for the same challenge, within the cooldown and
 *   the attempts `NestselfOtpService` enforces.
 *
 * The rows written on the way carry `via: 'sso_email_code'`. No audit row and
 * no log line carries the handle, the challenge token, the code, a token or,
 * in a log line, the address.
 *
 * @see docs/superpowers/specs/2026-10-30-auth-phase-4-pilot-readiness-design.md section 5.6
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type {
  Locale,
  SsoBindResendResponse,
  SsoBindStartRequest,
  SsoBindStartResponse,
  SsoBindVerifyRequest,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { IdTokenClaims } from '../identity/identity-provider.service.js';
import { DbService } from '../db/db.service.js';
import { SsoRepository, type SsoConnectionRow } from '../db/repositories/sso.repository.js';
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import {
  FederatedBindingService,
  bindingFailureReason,
  domainOf,
  type Binding,
  type RequestMeta,
} from './federated-binding.service.js';
import { IdentityResolutionService, federatedProvider } from './identity-resolution.service.js';
import { NestselfOtpService } from './nestself-otp.service.js';
import { PendingBindStore, pendingBindId, type TakenPendingBind } from './pending-bind-store.js';

/** The mail language when the page sent none. */
const DEFAULT_LOCALE: Locale = 'sr-Latn';

/** How the rows of this flow say the address was confirmed. */
const VIA = 'sso_email_code';

export interface SsoBindVerifyResult {
  returnPath: string;
  /** The new session: the controller writes the cookies. */
  session: { sessionId: string; csrfToken: string; absoluteExpiresAt: Date };
}

function invalidChallenge(status: 400 | 401): ApiHttpException {
  return new ApiHttpException({ status, code: 'invalid_challenge', message: 'Challenge expired or invalid' });
}

function ssoDenied(): ApiHttpException {
  return new ApiHttpException({ status: 403, code: 'sso_denied', message: 'The federated sign-in was not bound' });
}

/** The ID-token claims the binding needs, rebuilt from the pending record (the address is now confirmed). */
function claimsOf(record: TakenPendingBind): IdTokenClaims {
  return {
    sub: record.sub,
    email: record.email,
    emailVerified: true,
    identities: [{ providerName: record.providerName, userId: record.sub }],
    username: record.username,
    authTime: Math.floor(new Date(record.createdAt).getTime() / 1000),
  };
}

@Injectable()
export class SsoBindService {
  private readonly logger = new Logger(SsoBindService.name);

  constructor(
    @Inject(forwardRef(() => NestselfOtpService)) private readonly otp: NestselfOtpService,
    @Inject(forwardRef(() => PendingBindStore)) private readonly pendingBinds: PendingBindStore,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => DbService)) private readonly dbs: DbService,
    @Inject(forwardRef(() => FederatedBindingService)) private readonly binding: FederatedBindingService,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identity: IdentityResolutionService,
  ) {}

  // -------------------------------------------------------------------------
  // POST /auth/sso/bind/start
  // -------------------------------------------------------------------------

  async start(body: SsoBindStartRequest, _meta: RequestMeta): Promise<SsoBindStartResponse> {
    const id = pendingBindId(body.handle);
    const record = await this.pendingBinds.peek(id);
    if (!record) throw invalidChallenge(400);
    // The challenge names the record by its id, never by the handle.
    return this.otp.issue({
      purpose: 'sso_bind',
      email: record.email,
      locale: body.locale ?? DEFAULT_LOCALE,
      template: 'sso_bind_code',
      data: { pendingBindId: id },
    });
  }

  // -------------------------------------------------------------------------
  // POST /auth/sso/bind/verify
  // -------------------------------------------------------------------------

  async verify(body: SsoBindVerifyRequest, meta: RequestMeta): Promise<SsoBindVerifyResult> {
    const { data } = await this.otp.verify('sso_bind', body.challengeToken, body.code);
    // Single use: a second code for the same handle finds nothing.
    const record = data.pendingBindId ? await this.pendingBinds.take(data.pendingBindId) : null;
    if (!record) throw invalidChallenge(401);

    // 1. The IdP account was bound since the record was opened (two tabs, a
    //    retry, a direct sign-in after the claim switch went off): path 1, as
    //    the callback runs it. Its pool user is not an orphan, so nothing on
    //    this branch deletes it, and nothing is bound twice.
    const existing = await this.identities.findExternalIdentity(federatedProvider(record.providerName), record.sub);
    if (existing) {
      const owner = await this.sso.findConnectionByProviderName(record.providerName);
      if (!(await this.binding.existingIdentityUsable(existing, owner))) {
        await this.auditFailed('sso_provider_mismatch', meta, owner, record.providerName);
        throw ssoDenied();
      }
      return this.signIn(record, owner, meta);
    }

    // 2-5. A new binding.
    const claims = claimsOf(record);
    const loaded = await this.sso.findConnection(record.connectionId);
    const connection = loaded && (await this.stillVouches(loaded, record)) ? loaded : null;
    if (!connection) {
      // Review Focus 2: suspended, renamed or its domain no longer verified meanwhile.
      await this.binding.denyBinding(claims, record.email, loaded, meta, 'connection_inactive', VIA);
      throw ssoDenied();
    }

    let binding: Binding | null;
    try {
      binding = await this.dbs.withOrgScope(connection.orgId, (tx) =>
        this.binding.bind(tx, connection, claims, record.email, federatedProvider(record.providerName), true, VIA),
      );
    } catch (err) {
      this.logger.error(`SSO identity binding failed: ${bindingFailureReason(err)}`);
      await this.auditFailed('sso_binding', meta, connection, record.providerName);
      throw ssoDenied();
    }
    if (!binding) {
      await this.binding.denyBinding(claims, record.email, connection, meta, 'no_invitation', VIA);
      throw ssoDenied();
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
        details: { emailNormalised: record.email, templateKey: binding.templateKey, via: VIA, connectionId: connection.id },
      });
    }
    await this.principalLoader.invalidateUser(binding.userId, [connection.orgId]);

    return this.signIn(record, connection, meta);
  }

  // -------------------------------------------------------------------------
  // POST /auth/sso/bind/resend
  // -------------------------------------------------------------------------

  async resend(challengeToken: string, locale: Locale): Promise<SsoBindResendResponse> {
    return this.otp.resend('sso_bind', challengeToken, locale);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The session from the stored token set, for a sign-in that bound or found
   * its identity. A staff test sign-in that got this far marks its TESTING
   * connection tested, as the callback's `signIn` does (for an existing
   * identity too, whatever else the connection's status).
   */
  private async signIn(
    record: TakenPendingBind,
    connection: SsoConnectionRow | null,
    meta: RequestMeta,
  ): Promise<SsoBindVerifyResult> {
    let session;
    try {
      session = await this.identity.resolveIdentityAndCreateSession(
        record.tokens,
        record.email,
        record.surface,
        meta,
        false,
        true,
        record.providerName,
      );
    } catch (err) {
      // A suspended or deactivated user: bound, but not signed in.
      this.logger.warn(`SSO session creation refused: ${(err as Error).message}`);
      await this.auditFailed('sso_session', meta, connection, record.providerName);
      throw ssoDenied();
    }

    if (connection?.status === 'TESTING' && connection.id === record.connectionId && record.testSignIn) {
      await this.dbs.withOrgScope(connection.orgId, (tx) =>
        this.sso.updateConnection(connection.id, { lastTestedAt: new Date() }, tx, { fromStatus: 'TESTING' }),
      );
    }

    return {
      returnPath: record.returnPath ?? '/',
      session: { sessionId: session.sessionId, csrfToken: session.csrfToken, absoluteExpiresAt: session.absoluteExpiresAt },
    };
  }

  /**
   * The connection may still bind this sign-in: ACTIVE (or TESTING for a
   * staff test sign-in), the same provider, the domain verified for it.
   */
  private async stillVouches(connection: SsoConnectionRow, record: TakenPendingBind): Promise<boolean> {
    const usable = connection.status === 'ACTIVE' || (connection.status === 'TESTING' && record.testSignIn);
    return (
      usable &&
      connection.cognitoProviderName === record.providerName &&
      (await this.binding.isDomainVerifiedFor(connection, domainOf(record.email)))
    );
  }

  /** Awaited; a failed write is swallowed (logged by the writer), the answer must still go out. */
  private async auditFailed(
    reason: string,
    meta: RequestMeta,
    connection: SsoConnectionRow | null,
    providerName: string,
  ): Promise<void> {
    await this.audit
      .record({
        action: 'auth.sign_in.failed',
        actorUserId: null,
        actorKind: 'USER',
        orgId: connection?.orgId ?? null,
        recordType: 'auth_attempt',
        recordId: connection?.cognitoProviderName ?? providerName,
        result: 'DENIED',
        ip: meta.ip,
        userAgent: meta.userAgent,
        details: { reason },
      })
      .catch(() => {});
  }
}
