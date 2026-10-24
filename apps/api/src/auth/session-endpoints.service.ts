import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';

import { SessionService } from '../session/session.service.js';

import {
  PrincipalLoader,
} from '../principal/principal-loader.js';
import { ContextLoader } from '../authz/context-loader.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import {
  wsTicketKey,
  WS_TICKET_TTL,
} from '../redis/redis-keys.js';
import { ApiHttpException } from '../common/api-error.js';
import {
  hasActiveDateCurrentMembership,
  resolveDefaultPersonalOrgId,
  computeAvailableContexts,
} from '../authz/personal-context.js';
import { effectiveActions as engineEffectiveActions } from '../authz/effective-access.js';
import type {
  Principal,
  ActiveContext,
  MeResponse,
} from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the orgId relevant for grant loading from a context. */
function contextOrgId(ctx: ActiveContext): string | undefined {
  if (ctx.kind === 'personal') return ctx.orgId;
  if (ctx.kind === 'organization') return ctx.orgId;
  return undefined;
}

/** Reject a switchContext request with 403 invalid_context (ruling 2). */
function denyContext(): never {
  throw new ApiHttpException({
    status: 403,
    code: 'invalid_context',
    message: 'The requested context is not available to this user',
  });
}

@Injectable()
export class SessionEndpointsService {
  constructor(
    @Inject(forwardRef(() => SessionService)) private readonly sessions: SessionService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => ContextLoader)) private readonly contextLoader: ContextLoader,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  async getMe(principal: Principal): Promise<MeResponse> {
    const loaded = await this.principalLoader.load(principal.userId);
    if (!loaded) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'User not found',
      });
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

  async switchContext(
    sessionId: string,
    principal: Principal,
    newContext: ActiveContext,
    lastPersonalOrgId?: string,
  ): Promise<MeResponse> {
    const loaded = await this.principalLoader.load(principal.userId);
    if (!loaded) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'User not found',
      });
    }

    // ACC-R-12: resolve personal context orgId before validation.
    let resolvedContext: ActiveContext = newContext;

    if (newContext.kind === 'personal') {
      if (newContext.orgId) {
        // (1) personal with orgId → verify ACTIVE, date-current membership.
        if (!hasActiveDateCurrentMembership(loaded.memberships, newContext.orgId)) {
          denyContext();
        }
        resolvedContext = { kind: 'personal', orgId: newContext.orgId };
      } else {
        // (2) personal without orgId → resolve default using sticky orgId.
        const lastUsed = lastPersonalOrgId
          ?? (principal.context.kind === 'personal' ? principal.context.orgId : undefined);
        const defaultOrgId = resolveDefaultPersonalOrgId(
          loaded.memberships,
          lastUsed,
        );
        resolvedContext = defaultOrgId
          ? { kind: 'personal', orgId: defaultOrgId }
          : { kind: 'personal' };
      }
    } else if (newContext.kind === 'organization') {
      // Must have an ACTIVE, date-current membership in the target org.
      if (!hasActiveDateCurrentMembership(loaded.memberships, newContext.orgId)) {
        denyContext();
      }
      // TODO(auth T-2.x, D-05): check second factor at organization context switch
    } else if (newContext.kind === 'expert') {
      if (loaded.expert == null) denyContext();
    } else if (newContext.kind === 'operations') {
      if (loaded.staffTemplates.length === 0) denyContext();
    }

    const population = this.resolvePopulation(loaded, resolvedContext);
    await this.sessions.updateContext(sessionId, resolvedContext, population);

    const updatedPrincipal = { ...principal, context: resolvedContext };
    const [extras, effectiveActions] = await Promise.all([
      this.principalLoader.loadAvailableContextExtras(loaded),
      this.loadEffectiveActions(updatedPrincipal),
    ]);
    return {
      principal: updatedPrincipal,
      effectiveActions,
      availableContexts: computeAvailableContexts(loaded, extras),
    };
  }

  async signOut(sessionId: string): Promise<void> {
    await this.sessions.destroy(sessionId, { revokeTokens: true });
  }

  async signOutAll(
    userId: string,
    currentSessionId: string,
  ): Promise<void> {
    await this.sessions.destroyAllForUser(userId, {
      exceptSessionId: currentSessionId,
    });
  }

  async destroySession(
    userId: string,
    targetSessionIdHash: string,
    currentSessionId: string,
  ): Promise<void> {
    const sessions = await this.sessions.listForUser(userId, currentSessionId);
    const target = sessions.find(
      (s) => s.sessionIdHash === targetSessionIdHash,
    );
    if (!target) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Session not found',
      });
    }
    if (target.isCurrent) {
      throw new ApiHttpException({
        status: 400,
        code: 'conflict',
        message: 'Cannot destroy current session via this endpoint',
      });
    }
    const destroyed = await this.sessions.destroyOwnedByHash(userId, targetSessionIdHash);
    if (!destroyed) {
      throw new ApiHttpException({
        status: 404,
        code: 'not_found',
        message: 'Session not found',
      });
    }
  }

  async getSessions(
    userId: string,
    currentSessionId: string | null,
  ): Promise<{
    sessions: Array<{
      sessionId: string;
      surface: 'workspace' | 'admin';
      createdAt: string;
      lastActivityAt: string;
      ipHash: string;
      userAgentFamily: string;
      isCurrent: boolean;
    }>;
  }> {
    const items = await this.sessions.listForUser(userId, currentSessionId);
    return {
      sessions: items.map((s) => ({
        sessionId: s.sessionIdHash,
        surface: s.surface,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        ipHash: s.ipHash,
        userAgentFamily: s.userAgentFamily,
        isCurrent: s.isCurrent,
      })),
    };
  }

  async createWsTicket(userId: string, auth?: Principal['auth']): Promise<string> {
    const ticket = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(ticket).digest('hex');
    await this.store.set(
      wsTicketKey(hash),
      JSON.stringify({ userId, createdAt: new Date().toISOString(), auth: auth ?? null }),
      { ttlSeconds: WS_TICKET_TTL },
    );
    return ticket;
  }

  /**
   * Load the effective actions for the given context using the authorization
   * engine (Ruling F). Evaluates `effectiveActions()` against the same
   * `ContextLoader` the guard uses, so personal-context users do not see
   * actions from organization-workspace templates.
   */
  private async loadEffectiveActions(
    principal: Principal,
  ): Promise<string[]> {
    // Use a synthetic resource scoped to the context's org so the context
    // loader builds the right grant set.
    const orgId = contextOrgId(principal.context) ?? 'platform';
    const resource = { type: 'synthetic', orgId: orgId === 'platform' ? undefined : orgId };
    const ctx = await this.contextLoader.build(principal, resource);
    return engineEffectiveActions(principal, ctx);
  }

  private resolvePopulation(
    loaded: { staffTemplates: unknown[]; expert: unknown | null },
    context: ActiveContext,
  ): 'employee' | 'expert' | 'staff' {
    if (loaded.staffTemplates.length > 0) return 'staff';
    if (loaded.expert && context.kind === 'expert') return 'expert';
    return 'employee';
  }
}
