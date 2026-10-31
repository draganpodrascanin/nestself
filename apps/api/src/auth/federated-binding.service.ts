/**
 * FederatedBindingService: binds a federated sign-in that has no identity yet
 * to a NestSelf user (D-04 paths 3 to 5, 3.4.5). The web callback
 * (`SsoCallbackService`) uses it, and so do the routes that finish a binding
 * later (the pending binding after an unverified OIDC email).
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
 * `identity.denied`. `isDomainVerifiedFor` and `isMemberOf` are the checks the
 * callers run around a binding.
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
import { IdentityRepository } from '../db/repositories/identity.repository.js';
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

const JIT_TEMPLATE = PERMISSION_TEMPLATES.find((t) => t.key === JIT_TEMPLATE_KEY)!;

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

  /** Invitation or JIT, in the caller's transaction of the connection's tenant; null when nothing binds. */
  async bind(
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

  /**
   * The user has an ACTIVE membership in the organization; system-context
   * read. An invited (not yet bound) or ended membership does not vouch for a
   * federated sign-in, whichever connection bound the identity.
   */
  async isMemberOf(userId: string, orgId: string): Promise<boolean> {
    const rows = await this.memberships.findByUserId(userId);
    return rows.some((m) => m.orgId === orgId && m.status === 'ACTIVE');
  }

  /** The email's domain is a verified domain of this connection. */
  async isDomainVerifiedFor(connection: SsoConnectionRow, domain: string): Promise<boolean> {
    const row = await this.sso.findDomainByName(domain);
    return !!row && row.connectionId === connection.id && row.verifiedAt !== null;
  }

  /** SSO-R-10: delete the orphan federated pool user, record `identity.denied`. */
  async denyBinding(
    claims: IdTokenClaims,
    email: string,
    connection: SsoConnectionRow | null,
    meta: RequestMeta,
    reason: BindingDenialReason,
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
        details: { emailNormalised: email, provider, via: `sso_${via}`, connectionId: connection.id },
      },
      { tx },
    );
  }
}
