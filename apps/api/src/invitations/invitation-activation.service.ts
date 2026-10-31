/**
 * InvitationActivationService — preview and accept invitations (T-1.5).
 *
 * The accept flow: validate token -> resolve/create user -> ensure IdP user ->
 * link external identity -> create membership -> create grants -> mark accepted
 * -> start sign-in challenge. All writes in one org-scoped transaction.
 *
 * Uses SignInService (now exported from AuthModule) for the post-acceptance
 * sign-in challenge, keeping ChallengeStore and throttle logic centralised.
 *
 * @see 3.7 rows 1-2 and 4, API-R-08, API-R-09
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { InvitationAcceptResponse, Locale, PermissionTemplateDefinition } from '@nestself/contracts';
import { DbService } from '../db/db.service.js';
import { InvitationsRepository } from '../db/repositories/invitations.repository.js';
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { SsoRepository } from '../db/repositories/sso.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { IdentityProviderService } from '../identity/identity-provider.service.js';
import { SignInService } from '../auth/sign-in.service.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import { ApiHttpException } from '../common/api-error.js';
import { hashToken, constantTimeHashCompare } from './invitation-token.js';
import { organizations } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/db.service.js';
import type { InvitationRow } from '../db/repositories/invitations.repository.js';
import { InvitationMembershipActivator, invitableTemplateFor } from './invitation-membership-activator.js';
import { apiOriginForSurface, buildSsoStartUrl } from '../auth/sso-start-url.js';

@Injectable()
export class InvitationActivationService {
  private readonly logger = new Logger(InvitationActivationService.name);

  constructor(
    @Inject(forwardRef(() => DbService)) private readonly dbs: DbService,
    @Inject(forwardRef(() => InvitationsRepository)) private readonly invitations: InvitationsRepository,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => SignInService)) private readonly signIn: SignInService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => InvitationMembershipActivator)) private readonly activator: InvitationMembershipActivator,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // -----------------------------------------------------------------------
  // Preview (GET /invitations/:token/preview) -- @Public, API-R-09
  // -----------------------------------------------------------------------

  async preview(token: string): Promise<{ organizationName: string }> {
    const tokenHash = hashToken(token);
    const now = new Date();

    // Look up without org scope (public route).
    const invitation = await this.invitations.findPendingByTokenHash(tokenHash, now);
    if (!invitation) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Invitation not found',
      });
    }

    // Constant-time comparison of the stored hash vs our computed hash.
    if (!constantTimeHashCompare(invitation.tokenHash, tokenHash)) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Invitation not found',
      });
    }

    // Fetch the organization name. Only reveal the org name (API-R-09).
    const [org] = await this.dbs.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, invitation.orgId));

    if (!org) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Invitation not found',
      });
    }

    return { organizationName: org.name };
  }

  // -----------------------------------------------------------------------
  // Accept (POST /invitations/accept) -- @Public, API-R-08
  // -----------------------------------------------------------------------

  /** `locale` is the language of the code email the email-OTP path sends; the pool default when absent. */
  async accept(
    token: string,
    surface: 'workspace' | 'admin',
    meta: { ip: string | null; userAgent: string | null },
    locale?: Locale,
  ): Promise<InvitationAcceptResponse> {
    const tokenHash = hashToken(token);
    const now = new Date();

    // Look up without org scope first to find the invitation.
    const invitation = await this.invitations.findByTokenHash(tokenHash);
    if (!invitation || invitation.revokedAt) {
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_invitation',
        message: 'Invalid or expired invitation',
      });
    }

    // Check expiry.
    if (invitation.expiresAt <= now) {
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_invitation',
        message: 'Invalid or expired invitation',
      });
    }

    // Constant-time comparison.
    if (!constantTimeHashCompare(invitation.tokenHash, tokenHash)) {
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_invitation',
        message: 'Invalid or expired invitation',
      });
    }

    // Only organization and employee templates are honoured (C1): an
    // invitation stored before the create-time check cannot mint a staff,
    // expert or platform grant.
    const template = invitableTemplateFor(invitation);
    if (!template) {
      throw new ApiHttpException({
        status: 401,
        code: 'invalid_invitation',
        message: 'Invalid invitation template',
      });
    }

    // Federated employees: nothing is written here (see ssoResponseFor).
    const sso = await this.ssoResponseFor(invitation, surface);
    if (sso) return sso;

    // Idempotent: if already accepted, return the same response shape with a
    // fresh challenge (do not create a second membership).
    if (invitation.acceptedAt) {
      return this.buildSignInResponse(invitation, template, surface, meta, { locale });
    }

    // Determine the temporary password for staff/expert populations.
    // Employee population uses email OTP, so no temp password needed.
    const tempPassword =
      template.population !== 'employee' ? this.generateTemporaryPassword() : undefined;

    // --- All writes inside one org-scoped transaction ---
    const { userId } = await this.dbs.withOrgScope(
      invitation.orgId,
      async (tx) => {
        // 0. Owner model (2026-10-24): one active employer_owner per
        //    organization. Checked before any write or IdP side effect.
        await this.activator.assertOwnerSlotFree(template, invitation.orgId, now, tx);

        // 1. Resolve or create the user.
        const { userId, created: userCreated } = await this.resolveOrCreateUser(
          invitation.email,
          tx,
        );

        // 2. Audit user.created before side effects (SESS-R-22), in this
        //    transaction: the row rolls back with the user if a later step fails.
        if (userCreated) {
          await this.audit.record(
            {
              action: 'user.created',
              actorUserId: null,
              actorKind: 'SYSTEM',
              orgId: invitation.orgId,
              recordType: 'user',
              recordId: userId,
              result: 'ALLOWED',
              details: { emailNormalised: invitation.email, via: 'invitation' },
            },
            { tx },
          );
        }

        // 3. Ensure identity-provider user exists (with temp password for
        //    staff/expert so the NEW_PASSWORD_REQUIRED challenge triggers).
        await this.ensureIdpUser(invitation.email, userId, tx, tempPassword);

        // 4. Audit identity.linked.
        await this.audit.record(
          {
            action: 'identity.linked',
            actorUserId: null,
            actorKind: 'SYSTEM',
            orgId: invitation.orgId,
            recordType: 'external_identity',
            recordId: userId,
            result: 'ALLOWED',
            details: { emailNormalised: invitation.email, provider: 'cognito' },
          },
          { tx },
        );

        // 5-7. Membership, default grants, invitation accepted (shared with
        //      the SSO callback).
        await this.activator.activateInvitationForUser(invitation, template, userId, now, tx);

        return { userId };
      },
    );

    // Audit invitation.accepted.
    await this.audit.record({
      action: 'invitation.accepted',
      actorUserId: userId,
      actorKind: 'USER',
      orgId: invitation.orgId,
      recordType: 'invitation',
      recordId: invitation.id,
      result: 'ALLOWED',
      details: { emailNormalised: invitation.email, templateKey: invitation.templateKey },
    });

    // Invalidate principal cache.
    await this.principalLoader.invalidateUser(userId, [invitation.orgId]);

    // Build sign-in response based on population.
    return this.buildSignInResponse(invitation, template, surface, meta, { tempPassword, locale });
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async resolveOrCreateUser(
    email: string,
    tx: DbExecutor,
  ): Promise<{ userId: string; created: boolean }> {
    const existing = await this.identities.findUserByEmail(email, tx);
    if (existing) {
      return { userId: existing.id, created: false };
    }

    // Create a new user.
    const localPart = email.split('@')[0] ?? email;
    const user = await this.identities.createUser(
      {
        email,
        displayName: localPart,
        locale: 'sr-Latn',
        emailVerifiedAt: new Date(),
      },
      tx,
    );

    return { userId: user.id, created: true };
  }

  private async ensureIdpUser(
    email: string,
    userId: string,
    tx: DbExecutor,
    temporaryPassword?: string,
  ): Promise<void> {
    const idpUser = await this.idp.findUserByEmail(email);
    if (idpUser) {
      // Ensure external_identities row exists.
      await this.identities.upsertExternalIdentity(
        {
          userId,
          provider: 'cognito',
          subject: idpUser.sub,
          cognitoUsername: idpUser.username,
          email,
          emailVerified: true,
        },
        tx,
      );
      return;
    }

    // Create the IdP user. suppressMessage: true because we handle emails.
    const created = await this.idp.createUser({
      email,
      locale: 'sr-Latn',
      emailVerified: true,
      suppressMessage: true,
      ...(temporaryPassword ? { temporaryPassword } : {}),
    });

    await this.identities.upsertExternalIdentity(
      {
        userId,
        provider: 'cognito',
        subject: created.sub,
        cognitoUsername: created.username,
        email,
        emailVerified: true,
      },
      tx,
    );
  }

  /**
   * SSO employees are not pre-staged (3.4.5 step 1): when the invitation's
   * email domain is a verified domain of an ACTIVE connection of the
   * inviting organization, acceptance creates nothing and hands back the
   * start URL. The invitation stays pending; the SSO callback binds it to the
   * federated identity (verified email + pending invitation of the
   * connection's organization).
   */
  private async ssoResponseFor(
    invitation: InvitationRow,
    surface: 'workspace' | 'admin',
  ): Promise<InvitationAcceptResponse | null> {
    const emailDomain = invitation.email.split('@')[1] ?? '';
    const hasSso = await this.invitations.hasSsoForEmailDomain(invitation.orgId, emailDomain);
    if (!hasSso) return null;
    const connection = await this.sso.findActiveConnectionForDomain(emailDomain);
    if (!connection || connection.orgId !== invitation.orgId) return null;
    return {
      method: 'sso',
      ssoStartUrl: buildSsoStartUrl(apiOriginForSurface(this.config, surface), {
        connection: connection.cognitoProviderName,
        surface,
      }),
      challengeToken: null,
      step: null,
    };
  }

  /**
   * Decide sign-in method by template population and return the response.
   *
   * Uses SignInService to create challenge tokens, keeping the ChallengeStore
   * and throttle logic centralised in AuthModule.
   *
   * - employee -> email OTP via SignInService.emailOtpStart(), in `locale`
   * - staff/expert/employer_admin -> password with temp password via
   *   SignInService.passwordSignIn(), returning NEW_PASSWORD_REQUIRED challenge
   * (SSO invitations never get here: `accept` answers them first.)
   */
  private async buildSignInResponse(
    invitation: InvitationRow,
    template: PermissionTemplateDefinition,
    surface: 'workspace' | 'admin',
    meta: { ip: string | null; userAgent: string | null },
    { tempPassword, locale }: { tempPassword?: string; locale?: Locale } = {},
  ): Promise<InvitationAcceptResponse> {
    const population = template.population;

    // Staff/expert/employer_admin: password flow with temporary password.
    if (population !== 'employee' && tempPassword) {
      try {
        const result = await this.signIn.passwordSignIn(
          invitation.email,
          tempPassword,
          surface,
          meta,
        );
        if ('step' in result) {
          // Only new_password and totp_enrol are valid invitation-acceptance
          // steps. An unexpected 'totp' challenge falls through to email OTP.
          if (result.step === 'new_password' || result.step === 'totp_enrol') {
            return {
              method: 'password',
              challengeToken: result.challengeToken,
              ssoStartUrl: null,
              step: result.step,
            };
          }
        }
        // Unexpected: tokens returned immediately. Fall through to email OTP.
      } catch {
        // Password flow failed; fall through to email OTP.
        this.logger.debug(
          `Password flow failed for ${invitation.email}; falling back to email OTP`,
        );
      }
    }

    // Employee population, or fallback: email OTP.
    try {
      const otpResult = await this.signIn.emailOtpStart(invitation.email, meta, locale);
      return {
        method: 'email_otp',
        challengeToken: otpResult.challengeToken,
        ssoStartUrl: null,
        step: null,
      };
    } catch {
      // If even the OTP start fails (e.g. throttled), return a best-effort
      // response. The user can retry via the normal sign-in page.
      this.logger.warn(`Email OTP start failed for ${invitation.email} during acceptance`);
      return {
        method: 'email_otp',
        challengeToken: null,
        ssoStartUrl: null,
        step: null,
      };
    }
  }

  /**
   * Generate a temporary password that satisfies Cognito's default policy:
   * >= 8 chars, uppercase, lowercase, digit, special character.
   */
  private generateTemporaryPassword(): string {
    const base = randomBytes(24).toString('base64url');
    return `${base}A1a!`;
  }
}
