/**
 * InvitationsService — create, import and revoke invitations (T-1.5).
 *
 * Services depend on repositories (never on DbService directly) so that
 * unit tests mock plain methods.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  type InvitationCreateRequest,
  type InvitationImportRequest,
  type InvitationImportResponse,
  type InvitationImportRowReason,
  type InvitationListQuery,
  type InvitationListResponse,
  type InvitationResponse,
} from '@nestself/contracts';
import { DbService } from '../db/db.service.js';
import { InvitationsRepository } from '../db/repositories/invitations.repository.js';
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
import { SsoRepository } from '../db/repositories/sso.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
import { generateToken, hashToken } from './invitation-token.js';
import { InvitationMailer } from './invitation-mailer.js';
import { orgUnits } from '../db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/db.service.js';
import { OWNER_TEMPLATE_KEY, findInvitableTemplate, ownerExists } from '../grants/grant-rules.js';

/** Milliseconds in 7 days. */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** `details.reason` (and import row reason) for an address another organization's SSO owns. */
export const SSO_DOMAIN_CLAIMED = 'sso_domain_claimed';

function ssoDomainClaimed(): ApiHttpException {
  return new ApiHttpException({
    status: 409,
    code: 'conflict',
    message: 'This email domain signs in through another organization\'s identity provider',
    details: { reason: SSO_DOMAIN_CLAIMED },
  });
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @Inject(forwardRef(() => DbService)) private readonly dbs: DbService,
    @Inject(forwardRef(() => InvitationsRepository)) private readonly invitations: InvitationsRepository,
    @Inject(forwardRef(() => MembershipsRepository)) private readonly memberships: MembershipsRepository,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => InvitationMailer)) private readonly mailer: InvitationMailer,
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
  ) {}

  // -----------------------------------------------------------------------
  // Create a single invitation
  // -----------------------------------------------------------------------

  async create(
    orgId: string,
    body: InvitationCreateRequest,
    actorUserId: string,
    isProduction: boolean,
  ) {
    this.validateTemplateKey(body.templateKey);
    if (await this.domainClaimedElsewhere(body.email, orgId)) throw ssoDomainClaimed();

    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_MS);

    const row = await this.dbs.withOrgScope(orgId, async (tx) => {
      // Owner model (2026-10-24): one active employer_owner per organization.
      if (body.templateKey === OWNER_TEMPLATE_KEY) {
        const [current] = await this.authzRepo.findActiveOwnerGrants(orgId, now, tx);
        if (current) throw ownerExists(current.subjectUserId);
      }

      // Validate orgUnitId belongs to the org.
      if (body.orgUnitId) {
        await this.assertOrgUnitBelongsToOrg(body.orgUnitId, orgId, tx);
      }

      // Duplicate detection: pending invitation for same email in org.
      const pending = await this.invitations.findPendingByEmailAndOrg(body.email, orgId, now, tx);
      if (pending) {
        throw new ApiHttpException({
          status: 409,
          code: 'duplicate_invitation',
          message: 'A pending invitation already exists for this email in this organization',
        });
      }

      // Already a member check.
      await this.assertNotAlreadyMember(body.email, orgId, tx);

      return this.invitations.create(
        {
          email: body.email,
          orgId,
          orgUnitId: body.orgUnitId ?? null,
          templateKey: body.templateKey,
          tokenHash,
          expiresAt,
          invitedByUserId: actorUserId,
        },
        tx,
      );
    });

    // Audit (never log token or hash).
    await this.audit.record({
      action: 'invitation.created',
      actorUserId,
      actorKind: 'USER',
      orgId,
      recordType: 'invitation',
      recordId: row.id,
      result: 'ALLOWED',
      details: { emailNormalised: body.email, templateKey: body.templateKey },
    });

    // Send email (fire-and-forget).
    const names = await this.mailNames(orgId, actorUserId);
    this.mailer
      .send({
        email: body.email,
        token,
        organizationName: names.organizationName,
        inviterDisplayName: names.inviterDisplayName,
      })
      .catch((err) => this.logger.warn(`Failed to send invitation email: ${String(err)}`));

    return this.toResponse(row, isProduction ? undefined : token);
  }

  // -----------------------------------------------------------------------
  // Bulk import
  // -----------------------------------------------------------------------

  async import(
    orgId: string,
    body: InvitationImportRequest,
    actorUserId: string,
    _isProduction: boolean,
  ): Promise<InvitationImportResponse> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_MS);
    const importBatchId = generateToken().slice(0, 16);

    // Pre-validate all rows.
    const errors: Array<{ email: string; reason: InvitationImportRowReason }> = [];
    const validRows: Array<{
      email: string;
      orgUnitId?: string | undefined;
      templateKey: string;
    }> = [];

    // Detect duplicates within the batch.
    const seenEmails = new Set<string>();
    const claimedCache = new Map<string, boolean>();

    for (const inv of body.invitations) {
      // Template key check.
      if (!findInvitableTemplate(inv.templateKey)) {
        errors.push({ email: inv.email, reason: 'invalid_template' });
        continue;
      }

      // Intra-batch duplicate.
      if (seenEmails.has(inv.email)) {
        errors.push({ email: inv.email, reason: 'duplicate_in_batch' });
        continue;
      }
      seenEmails.add(inv.email);

      if (await this.domainClaimedElsewhere(inv.email, orgId, claimedCache)) {
        errors.push({ email: inv.email, reason: SSO_DOMAIN_CLAIMED });
        continue;
      }

      validRows.push(inv);
    }

    let created = 0;
    let skipped = 0;
    const names = await this.mailNames(orgId, actorUserId);

    await this.dbs.withOrgScope(orgId, async (tx) => {
      // Validate org units upfront (deduplicated).
      const orgUnitIds = [...new Set(validRows.filter((r) => r.orgUnitId).map((r) => r.orgUnitId!))];
      for (const ouId of orgUnitIds) {
        try {
          await this.assertOrgUnitBelongsToOrg(ouId, orgId, tx);
        } catch {
          // Mark all rows referencing this unit as errors.
          const remaining = validRows.filter((r) => r.orgUnitId === ouId);
          for (const r of remaining) {
            errors.push({ email: r.email, reason: 'org_unit_outside_org' });
          }
          // Remove them from valid list (mutating the iteration is fine; we filter below).
        }
      }

      // Owner model (2026-10-24): employer_owner rows are refused while the
      // organization has an active owner.
      if (validRows.some((r) => r.templateKey === OWNER_TEMPLATE_KEY)) {
        const [current] = await this.authzRepo.findActiveOwnerGrants(orgId, now, tx);
        if (current) {
          for (const r of validRows.filter((v) => v.templateKey === OWNER_TEMPLATE_KEY)) {
            errors.push({ email: r.email, reason: 'owner_exists' });
          }
        }
      }

      const errorEmails = new Set(errors.map((e) => e.email));
      const toCreate = validRows.filter((r) => !errorEmails.has(r.email));

      for (const inv of toCreate) {
        // Pending invitation check.
        const pending = await this.invitations.findPendingByEmailAndOrg(inv.email, orgId, now, tx);
        if (pending) {
          skipped++;
          errors.push({ email: inv.email, reason: 'duplicate_invitation' });
          continue;
        }

        // Already a member check.
        const existingUser = await this.identities.findUserByEmail(inv.email, tx);
        if (existingUser) {
          const userMemberships = await this.memberships.findByUserId(existingUser.id, tx);
          const activeMembership = userMemberships.find(
            (m) => m.orgId === orgId && m.status === 'ACTIVE',
          );
          if (activeMembership) {
            skipped++;
            errors.push({ email: inv.email, reason: 'already_member' });
            continue;
          }
        }

        const token = generateToken();
        const row = await this.invitations.create(
          {
            email: inv.email,
            orgId,
            orgUnitId: inv.orgUnitId ?? null,
            templateKey: inv.templateKey,
            tokenHash: hashToken(token),
            expiresAt,
            invitedByUserId: actorUserId,
            importBatchId,
          },
          tx,
        );
        created++;

        // Audit per created invitation.
        await this.audit.record({
          action: 'invitation.created',
          actorUserId,
          actorKind: 'USER',
          orgId,
          recordType: 'invitation',
          recordId: row.id,
          result: 'ALLOWED',
          details: { emailNormalised: inv.email, templateKey: inv.templateKey, importBatchId },
        });

        // Fire-and-forget email.
        this.mailer
          .send({
            email: inv.email,
            token,
            organizationName: names.organizationName,
            inviterDisplayName: names.inviterDisplayName,
          })
          .catch((err) => this.logger.warn(`Failed to send invitation email: ${String(err)}`));
      }
    });

    return { created, skipped, errors };
  }

  // -----------------------------------------------------------------------
  // List pending
  // -----------------------------------------------------------------------

  /** Pending invitations of the organization, newest first, one page at a time. */
  async listPending(orgId: string, query: InvitationListQuery): Promise<InvitationListResponse> {
    const rows = await this.dbs.withOrgScope(orgId, (tx) =>
      this.invitations.listPending(orgId, { limit: query.limit, cursor: query.cursor, now: new Date() }, tx),
    );
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map((row) => this.toResponse(row) as InvitationResponse),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  // -----------------------------------------------------------------------
  // Revoke
  // -----------------------------------------------------------------------

  async revoke(orgId: string, invitationId: string, actorUserId: string) {
    const row = await this.dbs.withOrgScope(orgId, async (tx) => {
      const invitation = await this.invitations.findByIdAndOrg(invitationId, orgId, tx);
      if (!invitation) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Invitation not found',
        });
      }

      // Idempotent: already revoked → return as-is.
      if (invitation.revokedAt) {
        return invitation;
      }

      return this.invitations.revoke(invitation.id, new Date(), tx);
    });

    if (!row) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Invitation not found',
      });
    }

    await this.audit.record({
      action: 'invitation.revoked',
      actorUserId,
      actorKind: 'USER',
      orgId,
      recordType: 'invitation',
      recordId: row.id,
      result: 'ALLOWED',
      details: { emailNormalised: row.email },
    });

    return this.toResponse(row);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Display names for the invitation email; falls back to ids when unknown. */
  private async mailNames(
    orgId: string,
    actorUserId: string,
  ): Promise<{ organizationName: string; inviterDisplayName: string }> {
    const [organizationName, inviter] = await Promise.all([
      this.invitations.findOrganizationName(orgId),
      this.identities.findUserById(actorUserId),
    ]);
    return {
      organizationName: organizationName ?? orgId,
      inviterDisplayName: inviter?.displayName ?? 'Your organization',
    };
  }

  /** Only active organization and employee templates may be invited (C1). */
  private validateTemplateKey(key: string): void {
    if (!findInvitableTemplate(key)) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: `Invalid template key: ${key}`,
        details: { templateKey: key },
      });
    }
  }

  private async assertOrgUnitBelongsToOrg(
    orgUnitId: string,
    orgId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const [row] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), eq(orgUnits.orgId, orgId)));
    if (!row) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: `Org unit ${orgUnitId} does not belong to this organization`,
      });
    }
  }

  private async assertNotAlreadyMember(
    email: string,
    orgId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const existingUser = await this.identities.findUserByEmail(email, tx);
    if (!existingUser) return;

    const userMemberships = await this.memberships.findByUserId(existingUser.id, tx);
    const activeMembership = userMemberships.find(
      (m) => m.orgId === orgId && m.status === 'ACTIVE',
    );
    if (activeMembership) {
      throw new ApiHttpException({
        status: 409,
        code: 'already_member',
        message: 'A user with this email is already an active member in this organization',
      });
    }
  }

  private toResponse(
    row: NonNullable<Awaited<ReturnType<InvitationsRepository['findById']>>>,
    devToken?: string,
  ) {
    const response: Record<string, unknown> = {
      id: row.id,
      email: row.email,
      orgId: row.orgId,
      orgUnitId: row.orgUnitId ?? null,
      templateKey: row.templateKey,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      invitedByUserId: row.invitedByUserId,
      createdAt: row.createdAt.toISOString(),
    };
    if (devToken !== undefined) {
      response['devToken'] = devToken;
    }
    return response;
  }

  /**
   * The address's domain is a verified domain of an ACTIVE SSO connection of
   * another organization: its sign-ins go to that organization's IdP, which
   * would never bind this invitation. Read in the system context (not the
   * inviting tenant's), because RLS hides other tenants' connections.
   */
  private async domainClaimedElsewhere(
    email: string,
    orgId: string,
    cache?: Map<string, boolean>,
  ): Promise<boolean> {
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    const cached = cache?.get(domain);
    if (cached !== undefined) return cached;
    const connection = await this.sso.findActiveConnectionForDomain(domain);
    const claimed = !!connection && connection.orgId !== orgId;
    cache?.set(domain, claimed);
    return claimed;
  }
}
