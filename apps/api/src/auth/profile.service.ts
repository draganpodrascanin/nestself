/**
 * ProfileService — self-service profile updates for the signed-in user:
 * `PATCH /auth/me/locale` and `PATCH /auth/me/display-name`.
 *
 * Updates the users row, drops the principal cache (the next request sees the
 * change), records `user.updated`, and returns the refreshed `MeResponse`.
 * The locale is also the value synced to Cognito `custom:locale` [D-02]; that
 * sync happens on the next sign-in through the identity provider.
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { Locale, MeResponse, Principal } from '@nestself/contracts';

import { IdentityRepository } from '../db/repositories/identity.repository.js';

import { PrincipalLoader } from '../principal/principal-loader.js';
import { ContextLoader } from '../authz/context-loader.js';
import { effectiveActions as engineEffectiveActions } from '../authz/effective-access.js';

import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
import { computeAvailableContexts } from '../authz/personal-context.js';

type Meta = { ip: string | null; userAgent: string | null };

function computeInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}

@Injectable()
export class ProfileService {
  constructor(
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => ContextLoader)) private readonly contextLoader: ContextLoader,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {}

  async updateLocale(principal: Principal, locale: Locale, meta: Meta): Promise<MeResponse> {
    await this.apply(principal, { locale }, meta);
    const updatedPrincipal = { ...principal, locale };
    return this.buildMeResponse(updatedPrincipal);
  }

  async updateDisplayName(principal: Principal, displayName: string, meta: Meta): Promise<MeResponse> {
    await this.apply(principal, { displayName }, meta);
    const updatedPrincipal = { ...principal, displayName, initials: computeInitials(displayName) };
    return this.buildMeResponse(updatedPrincipal);
  }

  /** Build MeResponse with engine-based effectiveActions and extras (ruling 4, T-C1.02). */
  private async buildMeResponse(principal: Principal): Promise<MeResponse> {
    // Re-load the user after cache invalidation (apply already called invalidateUser).
    const loaded = await this.principalLoader.load(principal.userId);
    if (!loaded) {
      throw new ApiHttpException({ status: 401, code: 'unauthenticated', message: 'User not found' });
    }
    const [extras, effectiveActions] = await Promise.all([
      this.principalLoader.loadAvailableContextExtras(loaded),
      this.loadEffectiveActions(principal),
    ]);
    return {
      principal,
      effectiveActions,
      availableContexts: computeAvailableContexts(loaded, extras),
    };
  }

  private async loadEffectiveActions(principal: Principal): Promise<string[]> {
    const orgId =
      principal.context.kind === 'personal' ? principal.context.orgId
      : principal.context.kind === 'organization' ? principal.context.orgId
      : undefined;
    const resource = { type: 'synthetic', orgId };
    const ctx = await this.contextLoader.build(principal, resource);
    return engineEffectiveActions(principal, ctx);
  }

  private async apply(
    principal: Principal,
    patch: { locale?: string; displayName?: string },
    meta: Meta,
  ): Promise<void> {
    const row = await this.identities.updateProfile(principal.userId, patch);
    if (!row) {
      throw new ApiHttpException({ status: 401, code: 'unauthenticated', message: 'User not found' });
    }
    await this.audit.record({
      action: 'user.updated',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'user',
      recordId: principal.userId,
      result: 'ALLOWED',
      details: { fields: Object.keys(patch) },
      sessionId: principal.sessionId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.principalLoader.invalidateUser(principal.userId);
  }
}
