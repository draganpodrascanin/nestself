/**
 * InvitationsService — create, import and revoke invitations (T-1.5).
 *
 * Services depend on repositories (never on DbService directly) so that
 * unit tests mock plain methods.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  PERMISSION_TEMPLATES,
  type InvitationCreateRequest,
  type InvitationImportRequest,
} from '@nestself/contracts';
import { DbService } from '../db/db.service.js';
import { InvitationsRepository } from '../db/repositories/invitations.repository.js';
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
import { generateToken, hashToken } from './invitation-token.js';
import { InvitationMailer } from './invitation-mailer.js';
import { orgUnits } from '../db/schema/index.js';
import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/db.service.js';

/** Milliseconds in 7 days. */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const TEMPLATE_KEYS = new Set(PERMISSION_TEMPLATES.map((t) => t.key));

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

    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_MS);

    const row = await this.dbs.withOrgScope(orgId, async (tx) => {
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
  ) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_MS);
    const importBatchId = generateToken().slice(0, 16);

    // Pre-validate all rows.
    const errors: Array<{ email: string; reason: string }> = [];
    const validRows: Array<{
      email: string;
      orgUnitId?: string | undefined;
      templateKey: string;
    }> = [];

    // Detect duplicates within the batch.
    const seenEmails = new Set<string>();

    for (const inv of body.invitations) {
      // Template key check.
      if (!TEMPLATE_KEYS.has(inv.templateKey as never)) {
        errors.push({ email: inv.email, reason: `Invalid template key: ${inv.templateKey}` });
        continue;
      }

      // Intra-batch duplicate.
      if (seenEmails.has(inv.email)) {
        errors.push({ email: inv.email, reason: 'Duplicate within batch' });
        continue;
      }
      seenEmails.add(inv.email);

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
            errors.push({ email: r.email, reason: `Org unit ${ouId} does not belong to this organization` });
          }
          // Remove them from valid list (mutating the iteration is fine; we filter below).
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

  private validateTemplateKey(key: string): void {
    if (!TEMPLATE_KEYS.has(key as never)) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: `Invalid template key: ${key}`,
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
}
