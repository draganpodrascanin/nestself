/**
 * InvitationMembershipActivator: the membership half of invitation
 * acceptance, shared by `POST /invitations/accept` and the SSO callback
 * (3.4.5 "verified email matches a pending invitation", D-04).
 *
 * Given an invitation and the user it binds to, inside the caller's
 * org-scoped transaction: create the ACTIVE membership (unless one exists),
 * the template's default grants, record `membership.activated`, and mark the
 * invitation accepted. Identity-provider work and `invitation.accepted` stay
 * with the caller, which knows how the user proved the address.
 *
 * Also hosts `activateMembership` for JIT provisioning, which has no
 * invitation: same membership + `employee` grant + audit, no accept.
 *
 * @see 3.7 rows 1-2, 3.4.5, API-R-07
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import type { PermissionTemplateDefinition } from '@nestself/contracts';
import { InvitationsRepository } from '../db/repositories/invitations.repository.js';
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { memberships } from '../db/schema/index.js';
import { OWNER_TEMPLATE_KEY, isInvitableTemplate, ownerExists } from '../grants/grant-rules.js';
import type { DbExecutor } from '../db/db.service.js';
import type { InvitationRow } from '../db/repositories/invitations.repository.js';

const TEMPLATE_MAP = new Map<string, PermissionTemplateDefinition>(
  PERMISSION_TEMPLATES.map((t) => [t.key, t]),
);

/** The template an invitation may honour (C1: organization and employee templates only); null otherwise. */
export function invitableTemplateFor(invitation: Pick<InvitationRow, 'templateKey'>): PermissionTemplateDefinition | null {
  const template = TEMPLATE_MAP.get(invitation.templateKey ?? '');
  return template && isInvitableTemplate(template) ? template : null;
}

/** The `employee` template a JIT-provisioned membership receives. */
export const JIT_TEMPLATE_KEY = 'employee';

export interface MembershipActivationInput {
  userId: string;
  orgId: string;
  orgUnitId: string | null;
  template: PermissionTemplateDefinition;
  /** Recorded as the grant's `grantedByUserId`. */
  grantedByUserId: string;
  emailNormalised: string;
  now: Date;
  /** Extra audit detail, e.g. `{ via: 'sso_jit', connectionId }`. */
  details?: Record<string, unknown>;
}

@Injectable()
export class InvitationMembershipActivator {
  constructor(
    @Inject(forwardRef(() => InvitationsRepository)) private readonly invitations: InvitationsRepository,
    @Inject(forwardRef(() => MembershipsRepository)) private readonly membershipRepo: MembershipsRepository,
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {}

  /** Owner model (2026-10-24): one active `employer_owner` per organization; 409 otherwise. */
  async assertOwnerSlotFree(
    template: PermissionTemplateDefinition,
    orgId: string,
    now: Date,
    tx: DbExecutor,
  ): Promise<void> {
    if (template.key !== OWNER_TEMPLATE_KEY) return;
    const [current] = await this.authzRepo.findActiveOwnerGrants(orgId, now, tx);
    if (current) throw ownerExists(current.subjectUserId);
  }

  /**
   * Bind the invitation to `userId`: membership, grants, accepted. Runs in
   * the caller's `withOrgScope(invitation.orgId)` transaction.
   */
  async activateInvitationForUser(
    invitation: InvitationRow,
    template: PermissionTemplateDefinition,
    userId: string,
    now: Date,
    tx: DbExecutor,
  ): Promise<void> {
    await this.assertOwnerSlotFree(template, invitation.orgId, now, tx);
    await this.activateMembership(
      {
        userId,
        orgId: invitation.orgId,
        orgUnitId: invitation.orgUnitId,
        template,
        grantedByUserId: invitation.invitedByUserId,
        emailNormalised: invitation.email,
        now,
        details: { templateKey: invitation.templateKey },
      },
      tx,
    );
    await this.invitations.accept(invitation.id, now, userId, tx);
  }

  /**
   * ACTIVE membership + the template's default grants unless the user is
   * already an active member of the organization. Returns whether it created one.
   */
  async activateMembership(input: MembershipActivationInput, tx: DbExecutor): Promise<boolean> {
    const existing = await this.membershipRepo.findByUserId(input.userId, tx);
    if (existing.some((m) => m.orgId === input.orgId && m.status === 'ACTIVE')) return false;

    const [membership] = await tx
      .insert(memberships)
      .values({
        userId: input.userId,
        orgId: input.orgId,
        orgUnitId: input.orgUnitId,
        status: 'ACTIVE',
        startDate: input.now,
      })
      .returning();

    await this.audit.record(
      {
        action: 'membership.activated',
        actorUserId: null,
        actorKind: 'SYSTEM',
        orgId: input.orgId,
        recordType: 'membership',
        recordId: membership!.id,
        result: 'ALLOWED',
        details: { emailNormalised: input.emailNormalised, templateKey: input.template.key, ...input.details },
      },
      { tx },
    );

    await this.createDefaultGrants(input, tx);
    return true;
  }

  private async createDefaultGrants(input: MembershipActivationInput, tx: DbExecutor): Promise<void> {
    const { template } = input;
    // Belt and braces (C1): never a grant outside the organization.
    if (!isInvitableTemplate(template) || template.scopeType === 'platform') {
      throw new Error(`Invitation template ${template.key} is not an organization template`);
    }
    await this.authzRepo.createGrant(
      {
        subjectUserId: input.userId,
        templateKey: template.key,
        actions: [...template.actions],
        scopeType: template.scopeType,
        scopeOrgId: input.orgId,
        scopeOrgUnitId: template.scopeType === 'org_unit' ? input.orgUnitId : null,
        includeDescendants: template.scopeType === 'org_unit',
        validFrom: input.now,
        grantedByUserId: input.grantedByUserId,
      },
      tx,
    );
  }
}
