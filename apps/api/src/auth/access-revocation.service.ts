/**
 * AccessRevocationService — the revocation fan-out shared by membership end
 * (T-1.16, SESS-R-23), user suspension (T-1.18, SESS-R-24) and deactivation.
 *
 * Order matters (SESS-R-22): callers write the audit event first, then call
 * this service. Each step is attempted even if an earlier one failed so that a
 * Cognito outage never leaves a Redis session alive; failures are collected
 * and reported back for the audit trail.
 *
 * @see D-07, D-18, DR-15
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { SessionService } from '../session/session.service.js';

import { PrincipalLoader } from '../principal/principal-loader.js';

import { IdentityProviderService } from '../identity/identity-provider.service.js';

import { IdentityRepository } from '../db/repositories/identity.repository.js';

export interface RevocationOptions {
  /** Destroy only web sessions whose active context is this organization. */
  sessionsForOrgId?: string;
  /** Grants cache keys to drop for these organizations. */
  orgIds?: string[];
}

export interface RevocationReport {
  sessionsDestroyed: boolean;
  identitiesSignedOut: number;
  identitiesFailed: number;
  invalidated: boolean;
}

@Injectable()
export class AccessRevocationService {
  private readonly logger = new Logger(AccessRevocationService.name);

  constructor(
    @Inject(forwardRef(() => SessionService)) private readonly sessions: SessionService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
  ) {}

  /**
   * Destroy sessions, revoke every Cognito refresh token family through
   * `globalSignOut` for each of the user's external identities, and publish
   * the principal invalidation. Never throws; see the returned report.
   */
  async revokeAllAccess(userId: string, opts: RevocationOptions = {}): Promise<RevocationReport> {
    const report: RevocationReport = {
      sessionsDestroyed: false,
      identitiesSignedOut: 0,
      identitiesFailed: 0,
      invalidated: false,
    };

    try {
      await this.sessions.destroyAllForUser(
        userId,
        opts.sessionsForOrgId ? { orgId: opts.sessionsForOrgId } : undefined,
      );
      report.sessionsDestroyed = true;
    } catch (err) {
      this.logger.error(err, `Failed to destroy sessions for ${userId}`);
    }

    // AdminUserGlobalSignOut is unconditional (SESS-R-23): mobile tokens for
    // every organization are revoked even when other memberships remain.
    let identities: Array<{ cognitoUsername: string; provider: string }> = [];
    try {
      identities = await this.identities.findExternalIdentitiesForUser(userId);
    } catch (err) {
      this.logger.error(err, `Failed to load external identities for ${userId}`);
    }
    for (const identity of identities) {
      try {
        await this.idp.globalSignOut(identity.cognitoUsername);
        report.identitiesSignedOut++;
      } catch (err) {
        report.identitiesFailed++;
        // A native pool username is the email address: name the user and the provider instead.
        this.logger.error(err, `globalSignOut failed for user ${userId} (${identity.provider})`);
      }
    }

    try {
      await this.principalLoader.invalidateUser(userId, opts.orgIds);
      report.invalidated = true;
    } catch (err) {
      this.logger.error(err, `Failed to invalidate principal ${userId}`);
    }

    return report;
  }
}
