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
import { InvitationMailer, type InvitationMailInput } from './invitation-mailer.js';
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

type ImportRow = InvitationImportRequest['invitations'][number];

/** What became of one import row: it ends in exactly one bucket. */
type ImportRowOutcome =
  | { bucket: 'created' }
  | { bucket: 'skipped' }
  | { bucket: 'error'; reason: InvitationImportRowReason };

/** The import answer: one bucket per row, `errors` in the order of the rows sent. */
function buildImportResponse(
  rows: readonly ImportRow[],
  outcomes: ReadonlyMap<number, ImportRowOutcome>,
): InvitationImportResponse {
  let created = 0;
  let skipped = 0;
  const errors: InvitationImportResponse['errors'] = [];
  for (const [index, row] of rows.entries()) {
    const outcome = outcomes.get(index);
    if (outcome?.bucket === 'created') created++;
    else if (outcome?.bucket === 'skipped') skipped++;
    else if (outcome?.bucket === 'error') errors.push({ email: row.email, reason: outcome.reason });
    else throw new Error(`Import row ${index} ended in no bucket`);
  }
  return { created, skipped, errors };
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

      const invitation = await this.invitations.create(
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

      // Audited in the creating transaction, as the import does (never the token or its hash).
      await this.audit.record(
        {
          action: 'invitation.created',
          actorUserId,
          actorKind: 'USER',
          orgId,
          recordType: 'invitation',
          recordId: invitation.id,
          result: 'ALLOWED',
          details: { emailNormalised: body.email, templateKey: body.templateKey },
        },
        { tx },
      );
      return invitation;
    });

    // The transaction has committed: the invitation exists, so it may be mailed.
    const names = await this.mailNames(orgId, actorUserId);
    this.sendInvitationEmail({ email: body.email, token, ...names });

    return this.toResponse(row, isProduction ? undefined : token);
  }

  // -----------------------------------------------------------------------
  // Bulk import
  // -----------------------------------------------------------------------

  /**
   * Each row lands in exactly one of `created`, `skipped` (the address has a
   * pending invitation or is an active member: nothing to do) and `errors`
   * (the row was refused, with a code from `InvitationImportRowReason`). The
   * invitation mails go out after the transaction has committed, and only for
   * the created rows.
   */
  async import(
    orgId: string,
    body: InvitationImportRequest,
    actorUserId: string,
    _isProduction: boolean,
  ): Promise<InvitationImportResponse> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_MS);
    const importBatchId = generateToken().slice(0, 16);
    const rows = body.invitations;

    // What became of each row, by its position in the request. A row ends in
    // exactly one bucket (created, skipped or an error with a coded reason)
    // and the first check it fails decides which, so the three always add up
    // to the rows sent.
    const outcomes = new Map<number, ImportRowOutcome>();
    const reject = (index: number, reason: InvitationImportRowReason): void => {
      outcomes.set(index, { bucket: 'error', reason });
    };

    // Checks that need no organization transaction. A repeated address marks
    // only its later rows; the first goes on to be processed like any other.
    const processable: Array<{ index: number; row: ImportRow }> = [];
    const seenEmails = new Set<string>();
    const claimedCache = new Map<string, boolean>();

    for (const [index, row] of rows.entries()) {
      if (!findInvitableTemplate(row.templateKey)) {
        reject(index, 'invalid_template');
        continue;
      }

      if (seenEmails.has(row.email)) {
        reject(index, 'duplicate_in_batch');
        continue;
      }
      seenEmails.add(row.email);

      if (await this.domainClaimedElsewhere(row.email, orgId, claimedCache)) {
        reject(index, SSO_DOMAIN_CLAIMED);
        continue;
      }

      processable.push({ index, row });
    }

    const names = await this.mailNames(orgId, actorUserId);
    // Collected inside the transaction, mailed after it: an email must not
    // outlive a rollback (a failure on a later row undoes the earlier ones).
    const toMail: Array<Pick<InvitationMailInput, 'email' | 'token'>> = [];

    await this.dbs.withOrgScope(orgId, async (tx) => {
      // Org units of other organizations, each unit looked up once.
      const outsideUnits = new Set<string>();
      const unitIds = new Set(processable.flatMap(({ row }) => (row.orgUnitId ? [row.orgUnitId] : [])));
      for (const unitId of unitIds) {
        if (!(await this.orgUnitInOrg(unitId, orgId, tx))) outsideUnits.add(unitId);
      }

      // Owner model (2026-10-24): employer_owner rows are refused while the
      // organization has an active owner.
      const ownerTaken =
        processable.some(({ row }) => row.templateKey === OWNER_TEMPLATE_KEY) &&
        (await this.authzRepo.findActiveOwnerGrants(orgId, now, tx)).length > 0;

      for (const { index, row } of processable) {
        if (row.orgUnitId && outsideUnits.has(row.orgUnitId)) {
          reject(index, 'org_unit_outside_org');
          continue;
        }

        if (ownerTaken && row.templateKey === OWNER_TEMPLATE_KEY) {
          reject(index, 'owner_exists');
          continue;
        }

        // A pending invitation or an active membership means there is nothing
        // to do for this address: the row is skipped, not a failure.
        const pending = await this.invitations.findPendingByEmailAndOrg(row.email, orgId, now, tx);
        if (pending || (await this.isActiveMember(row.email, orgId, tx))) {
          outcomes.set(index, { bucket: 'skipped' });
          continue;
        }

        const token = generateToken();
        const invitation = await this.invitations.create(
          {
            email: row.email,
            orgId,
            orgUnitId: row.orgUnitId ?? null,
            templateKey: row.templateKey,
            tokenHash: hashToken(token),
            expiresAt,
            invitedByUserId: actorUserId,
            importBatchId,
          },
          tx,
        );

        // Audit per created invitation, in the import transaction.
        await this.audit.record(
          {
            action: 'invitation.created',
            actorUserId,
            actorKind: 'USER',
            orgId,
            recordType: 'invitation',
            recordId: invitation.id,
            result: 'ALLOWED',
            details: { emailNormalised: row.email, templateKey: row.templateKey, importBatchId },
          },
          { tx },
        );

        toMail.push({ email: row.email, token });
        outcomes.set(index, { bucket: 'created' });
      }
    });

    // The transaction has committed: the invitations exist, so they may be mailed.
    for (const { email, token } of toMail) {
      this.sendInvitationEmail({ email, token, ...names });
    }

    return buildImportResponse(rows, outcomes);
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

  /**
   * Fire-and-forget, and only after the transaction that created the
   * invitation has committed. A mail that cannot be sent is logged and does
   * not fail the request: the invitation stands, and an administrator can
   * revoke it and invite again.
   */
  private sendInvitationEmail(input: InvitationMailInput): void {
    this.mailer
      .send(input)
      .catch((err) => this.logger.warn(`Failed to send invitation email: ${String(err)}`));
  }

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

  private async orgUnitInOrg(orgUnitId: string, orgId: string, tx: DbExecutor): Promise<boolean> {
    const [row] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), eq(orgUnits.orgId, orgId)));
    return row !== undefined;
  }

  private async assertOrgUnitBelongsToOrg(
    orgUnitId: string,
    orgId: string,
    tx: DbExecutor,
  ): Promise<void> {
    if (!(await this.orgUnitInOrg(orgUnitId, orgId, tx))) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: `Org unit ${orgUnitId} does not belong to this organization`,
      });
    }
  }

  private async isActiveMember(email: string, orgId: string, tx: DbExecutor): Promise<boolean> {
    const existingUser = await this.identities.findUserByEmail(email, tx);
    if (!existingUser) return false;

    const userMemberships = await this.memberships.findByUserId(existingUser.id, tx);
    return userMemberships.some((m) => m.orgId === orgId && m.status === 'ACTIVE');
  }

  private async assertNotAlreadyMember(
    email: string,
    orgId: string,
    tx: DbExecutor,
  ): Promise<void> {
    if (await this.isActiveMember(email, orgId, tx)) {
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
