import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
 
import { SessionService } from '../session/session.service.js';
 
import {
  PrincipalLoader,
} from '../principal/principal-loader.js';
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
  isMembershipDateCurrent,
  resolveDefaultPersonalOrgId,
  computeAvailableContexts,
} from '../authz/personal-context.js';
import { membershipContextCode } from '../authz/context.js';
import type {
  Principal,
  ActiveContext,
  MeResponse,
  GrantInput,
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

/**
 * Compute the flat list of effective actions from loaded grants.
 * Filters out revoked and out-of-validity grants (Ruling F, T-C1.02).
 */
function computeEffectiveActions(grants: GrantInput[], now: Date): string[] {
  const actions = new Set<string>();
  for (const g of grants) {
    if (g.revokedAt != null) continue;
    if (g.validFrom != null && g.validFrom > now) continue;
    if (g.validUntil != null && g.validUntil <= now) continue;
    for (const a of g.actions) actions.add(a);
  }
  return [...actions];
}

@Injectable()
export class SessionEndpointsService {
  constructor(
    @Inject(forwardRef(() => SessionService)) private readonly sessions: SessionService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
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
      this.loadEffectiveActions(principal.userId, principal.context),
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
          throw new ApiHttpException({
            status: 403,
            code: 'invalid_context',
            message: 'The requested context is not available to this user',
          });
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
    } else {
      // Non-personal: validate context kind.
      if (newContext.kind === 'organization') {
        // Must have an ACTIVE, date-current membership in the target org.
        const membership = loaded.memberships.find(
          (m) => m.orgId === newContext.orgId,
        );
        if (!membership) {
          throw new ApiHttpException({
            status: 403,
            code: 'invalid_context',
            message: 'The requested context is not available to this user',
          });
        }
        if (!isMembershipDateCurrent(membership)) {
          throw new ApiHttpException({
            status: 403,
            code: membershipContextCode(membership, new Date()),
            message: 'The requested context is not available to this user',
          });
        }
      } else if (newContext.kind === 'expert') {
        if (loaded.expert == null) {
          throw new ApiHttpException({
            status: 403,
            code: 'invalid_context',
            message: 'The requested context is not available to this user',
          });
        }
      } else if (newContext.kind === 'operations') {
        if (loaded.staffTemplates.length === 0) {
          throw new ApiHttpException({
            status: 403,
            code: 'invalid_context',
            message: 'The requested context is not available to this user',
          });
        }
      }
    }

    const population = this.resolvePopulation(loaded, resolvedContext);
    await this.sessions.updateContext(sessionId, resolvedContext, population);

    const [extras, effectiveActions] = await Promise.all([
      this.principalLoader.loadAvailableContextExtras(loaded),
      this.loadEffectiveActions(principal.userId, resolvedContext),
    ]);
    return {
      principal: { ...principal, context: resolvedContext },
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
   * Load the effective actions for the given context.
   * Uses the same grant loader the authorization engine relies on (Ruling F).
   */
  private async loadEffectiveActions(
    userId: string,
    ctx: ActiveContext,
  ): Promise<string[]> {
    const orgId = contextOrgId(ctx);
    // loadGrants(userId, orgId) returns org-scoped + platform/own-scoped grants.
    // For contexts without an orgId we pass '' which matches only scopeOrgId IS NULL.
    const grants = await this.principalLoader.loadGrants(userId, orgId ?? '');
    return computeEffectiveActions(grants, new Date());
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
