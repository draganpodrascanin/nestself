/**
 * UsersService — platform-level user suspension and reinstatement (T-1.18).
 *
 * POST /ops/users/:userId/suspend   — suspends the user account
 * POST /ops/users/:userId/reinstate — clears suspension and re-enables IdP
 *
 * @see API-R-27, SESS-R-24, D-18
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { UserReinstateResponse, UserSuspendRequest, UserSuspendResponse } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { IdentityProviderService } from '../identity/identity-provider.service.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { AccessRevocationService } from '../auth/access-revocation.service.js';
import { PrincipalLoader } from '../principal/principal-loader.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => AccessRevocationService)) private readonly revocation: AccessRevocationService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
  ) {}

  /**
   * Suspend a user account (SESS-R-24).
   *
   * Idempotent: if already suspended, keeps the original timestamp but
   * still re-runs the revocation fan-out.
   */
  async suspendUser(
    userId: string,
    body: UserSuspendRequest,
    actorUserId: string,
  ): Promise<UserSuspendResponse> {
    const user = await this.identities.findUserById(userId);
    if (!user) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'User not found',
      });
    }

    const now = new Date();
    const alreadySuspended = user.suspendedAt != null;

    // Set suspendedAt (idempotent: keep original timestamp).
    if (!alreadySuspended) {
      await this.identities.setSuspended(userId, now);
    }

    const suspendedAt = alreadySuspended ? user.suspendedAt! : now;

    // Audit first (SESS-R-22); `user.suspended` maps to the SECURITY tier (API-R-27).
    await this.audit.record({
      action: 'user.suspended',
      actorUserId,
      actorKind: 'USER',
      orgId: null,
      recordType: 'user',
      recordId: userId,
      result: 'ALLOWED',
      details: { reason: body.reason },
    });

    // Disable each external identity in the IdP (catch and log failures).
    await this.disableIdpIdentities(userId);

    // Revoke all access (sessions, Cognito global sign-out, cache invalidation).
    await this.revocation.revokeAllAccess(userId);

    return {
      userId,
      suspendedAt: suspendedAt.toISOString(),
    };
  }

  /**
   * Reinstate a suspended user.
   */
  async reinstateUser(
    userId: string,
    actorUserId: string,
  ): Promise<UserReinstateResponse> {
    const user = await this.identities.findUserById(userId);
    if (!user) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'User not found',
      });
    }

    if (user.suspendedAt == null) {
      // Already active — idempotent.
      return { userId, reinstatedAt: new Date().toISOString() };
    }

    await this.identities.setSuspended(userId, null);

    // The cached principal still says suspended: without this the user stays
    // locked out (and the access lookup shows them suspended) until it expires.
    try {
      await this.principalLoader.invalidateUser(userId);
    } catch (err) {
      this.logger.error(err, `Failed to invalidate principal ${userId}`);
    }

    // Re-enable each external identity in the IdP.
    await this.enableIdpIdentities(userId);

    await this.audit.record({
      action: 'user.reactivated',
      actorUserId,
      actorKind: 'USER',
      orgId: null,
      recordType: 'user',
      recordId: userId,
      result: 'ALLOWED',
      details: {},
    });

    return { userId, reinstatedAt: new Date().toISOString() };
  }

  /** Disable all external IdP identities for a user. Catches and logs failures. */
  private async disableIdpIdentities(userId: string): Promise<void> {
    let identities: Array<{ cognitoUsername: string }> = [];
    try {
      identities = await this.identities.findExternalIdentitiesForUser(userId);
    } catch (err) {
      this.logger.error(err, `Failed to load external identities for ${userId}`);
      return;
    }
    for (const identity of identities) {
      try {
        await this.idp.disableUser(identity.cognitoUsername);
      } catch (err) {
        this.logger.error(err, `disableUser failed for ${identity.cognitoUsername}`);
      }
    }
  }

  /** Enable all external IdP identities for a user. Catches and logs failures. */
  private async enableIdpIdentities(userId: string): Promise<void> {
    let identities: Array<{ cognitoUsername: string }> = [];
    try {
      identities = await this.identities.findExternalIdentitiesForUser(userId);
    } catch (err) {
      this.logger.error(err, `Failed to load external identities for ${userId}`);
      return;
    }
    for (const identity of identities) {
      try {
        await this.idp.enableUser(identity.cognitoUsername);
      } catch (err) {
        this.logger.error(err, `enableUser failed for ${identity.cognitoUsername}`);
      }
    }
  }
}
