/**
 * FederatedBindingService: binds a federated sign-in that has no identity yet
 * to a NestSelf user (D-04 paths 3 to 5, 3.4.5). The web callback
 * (`SsoCallbackService`) uses it, and so do the routes that finish a binding
 * later (`SsoBindService`: the pending binding after an unverified OIDC
 * email, whose rows say the address was confirmed `via: 'sso_email_code'`).
 *
 * `bind` runs inside the connection's tenant transaction:
 *   - a pending invitation of the connection's organization (Review Focus 2)
 *     for the same email (lowercased, trimmed, timing-safe: SSO-R-09) binds
 *     and activates the membership;
 *   - else JIT when the connection is ACTIVE (never while TESTING), enables
 *     it and the domain is verified for it: user (reused by email), ACTIVE
 *     membership in the default unit with the `employee` grant;
 *   - else nothing binds (null).
 * The identity records the connection it was bound through
 * (`ssoConnectionId`), which every later sign-in checks. The rows `bind`
 * writes are audited in the same transaction.
 *
 * `denyBinding` deletes the orphan federated pool user (SSO-R-10) and records
 * `identity.denied`; it is for sign-ins without an identity only.
 * `existingIdentityUsable` is path 1 for those with one (the callback and the
 * email-code binding both use it), and `isDomainVerifiedFor` is the domain
 * check the callers run before a binding.
 *
 * @see D-04, SSO-R-08..11
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import {
  IdentityProviderError,
  IdentityProviderService,
  type IdTokenClaims,
} from '../identity/identity-provider.service.js';
import type { DbExecutor } from '../db/db.service.js';
import { SsoRepository, type SsoConnectionRow } from '../db/repositories/sso.repository.js';
import { IdentityRepository, type ExternalIdentityRow } from '../db/repositories/identity.repository.js';
import { InvitationsRepository } from '../db/repositories/invitations.repository.js';
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import {
  InvitationMembershipActivator,
  JIT_TEMPLATE_KEY,
  invitableTemplateFor,
} from '../invitations/invitation-membership-activator.js';

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** What a successful `bind` created. */
export type Binding =
  | { kind: 'invitation'; userId: string; invitationId: string; templateKey: string | null }
  | { kind: 'jit'; userId: string };

/** Why a federated sign-in bound nothing (`identity.denied` details). */
export type BindingDenialReason = 'connection_inactive' | 'email_off_domain' | 'email_unverified' | 'no_invitation';

/**
 * How the address was confirmed when the identity provider did not: the
 * user entered the code NestSelf mailed to it. Recorded as the `via` of
 * `identity.linked` and `identity.denied`.
 */
export type AddressConfirmation = 'sso_email_code';

const JIT_TEMPLATE = PERMISSION_TEMPLATES.find((t) => t.key === JIT_TEMPLATE_KEY)!;

/** A SQLSTATE: five digits or upper-case letters. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * An error of the federated sign-in (a failed binding transaction, a refused
 * session) as a reason a log line may carry: the error's name and the
 * driver's SQLSTATE. Never the message: Drizzle puts the statement and its
 * parameters there, the address among them, and other errors may name it too.
 */
export function bindingFailureReason(err: unknown): string {
  const name = err instanceof Error ? err.name : 'error';
  const failure = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  const code = failure?.cause?.code ?? failure?.code;
  return typeof code === 'string' && SQLSTATE.test(code) ? `${name} (SQLSTATE ${code})` : name;
}

/** SSO-R-09: lowercased, trimmed, timing-safe. */
export function sameEmail(a: string, b: string): boolean {
  const x = createHash('sha256').update(a.trim().toLowerCase()).digest();
  const y = createHash('sha256').update(b.trim().toLowerCase()).digest();
  return timingSafeEqual(x, y);
}

/** The part of an address after its last `@`. */
export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

@Injectable()
export class FederatedBindingService {
  private readonly logger = new Logger(FederatedBindingService.name);

  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => InvitationsRepository)) private readonly invitations: InvitationsRepository,
    @Inject(forwardRef(() => InvitationMembershipActivator)) private readonly activator: InvitationMembershipActivator,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => MembershipsRepository)) private readonly memberships: MembershipsRepository,
  ) {}

  /**
   * Invitation or JIT, in the caller's transaction of the connection's
   * tenant; null when nothing binds. `confirmedBy` is set when NestSelf, not
   * the identity provider, confirmed the address.
   */
  async bind(
    tx: DbExecutor,
    connection: SsoConnectionRow,
    claims: IdTokenClaims,
    email: string,
    provider: string,
    domainVerified: boolean,
    confirmedBy?: AddressConfirmation,
  ): Promise<Binding | null> {
    const now = new Date();

    // Only the connection's organization (Review Focus 2): the lookup is
    // scoped to it and RLS keeps other tenants' invitations out of reach.
    const invitation = await this.invitations.findPendingByEmailAndOrg(email, connection.orgId, now, tx);
    const template = invitation ? invitableTemplateFor(invitation) : null;
    if (invitation && template && invitation.orgId === connection.orgId && sameEmail(invitation.email, email)) {
      const userId = await this.resolveOrCreateUser(email, connection, tx, 'sso_invitation');
      await this.linkIdentity(tx, userId, claims, email, provider, connection, confirmedBy ?? 'sso_invitation');
      await this.activator.activateInvitationForUser(invitation, template, userId, now, tx);
      return { kind: 'invitation', userId, invitationId: invitation.id, templateKey: invitation.templateKey };
    }

    // JIT never runs while the connection is only being tested.
    if (connection.status === 'ACTIVE' && connection.jitProvisioning && domainVerified) {
      const userId = await this.resolveOrCreateUser(email, connection, tx, 'sso_jit');
      await this.audit.record(
        {
          action: 'identity.created',
          actorUserId: null,
          actorKind: 'SYSTEM',
          orgId: connection.orgId,
          recordType: 'external_identity',
          recordId: userId,
          result: 'ALLOWED',
          details: { emailNormalised: email, provider, via: 'sso_jit', connectionId: connection.id },
        },
        { tx },
      );
      await this.linkIdentity(tx, userId, claims, email, provider, connection, confirmedBy ?? 'sso_jit');
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

  /**
   * Path 1 (D-04): an existing federated identity may sign in through the
   * connection that now owns its provider name, provided that connection
   * exists, the identity was bound through that very connection
   * (`ssoConnectionId`; null matches none) and its user is an ACTIVE member
   * of the connection's organization. A provider name reused by another
   * organization would otherwise hand it the first organization's pool users
   * (Cognito keeps them, with their `sub`). The membership is read only when
   * the binding matches. Callers answer a refusal with the neutral denial and
   * `auth.sign_in.failed { reason: 'sso_provider_mismatch' }`, and never
   * delete the pool user: it is not an orphan.
   */
  async existingIdentityUsable(
    existing: Pick<ExternalIdentityRow, 'userId' | 'ssoConnectionId'>,
    connection: SsoConnectionRow | null,
  ): Promise<boolean> {
    return (
      !!connection &&
      existing.ssoConnectionId === connection.id &&
      (await this.isMemberOf(existing.userId, connection.orgId))
    );
  }

  /** The email's domain is a verified domain of this connection. */
  async isDomainVerifiedFor(connection: SsoConnectionRow, domain: string): Promise<boolean> {
    const row = await this.sso.findDomainByName(domain);
    return !!row && row.connectionId === connection.id && row.verifiedAt !== null;
  }

  /**
   * SSO-R-10: delete the orphan federated pool user, record `identity.denied`
   * (with `via` when NestSelf had confirmed the address).
   */
  async denyBinding(
    claims: IdTokenClaims,
    email: string,
    connection: SsoConnectionRow | null,
    meta: RequestMeta,
    reason: BindingDenialReason,
    confirmedBy?: AddressConfirmation,
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
        ...(confirmedBy ? { via: confirmedBy } : {}),
      },
    });
  }

  /**
   * The user has an ACTIVE membership in the organization; system-context
   * read. An invited (not yet bound) or ended membership does not vouch for a
   * federated sign-in, whichever connection bound the identity.
   */
  private async isMemberOf(userId: string, orgId: string): Promise<boolean> {
    const rows = await this.memberships.findByUserId(userId);
    return rows.some((m) => m.orgId === orgId && m.status === 'ACTIVE');
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
    await this.audit.record(
      {
        action: 'user.created',
        actorUserId: null,
        actorKind: 'SYSTEM',
        orgId: connection.orgId,
        recordType: 'user',
        recordId: user.id,
        result: 'ALLOWED',
        details: { emailNormalised: email, via, connectionId: connection.id },
      },
      { tx },
    );
    return user.id;
  }

  private async linkIdentity(
    tx: DbExecutor,
    userId: string,
    claims: IdTokenClaims,
    email: string,
    provider: string,
    connection: SsoConnectionRow,
    /** `identity.linked` details: the binding path, or how NestSelf confirmed the address. */
    via: 'sso_invitation' | 'sso_jit' | AddressConfirmation,
  ): Promise<void> {
    await this.identities.createExternalIdentity(
      {
        userId,
        provider,
        subject: claims.sub,
        cognitoUsername: claims.username,
        email,
        emailVerified: true,
        ssoConnectionId: connection.id,
        lastSeenAt: new Date(),
      },
      tx,
    );
    await this.audit.record(
      {
        action: 'identity.linked',
        actorUserId: null,
        actorKind: 'SYSTEM',
        orgId: connection.orgId,
        recordType: 'external_identity',
        recordId: userId,
        result: 'ALLOWED',
        details: { emailNormalised: email, provider, via, connectionId: connection.id },
      },
      { tx },
    );
  }
}
