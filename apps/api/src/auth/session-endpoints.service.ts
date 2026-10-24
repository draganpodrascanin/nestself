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
  resolveDefaultPersonalOrgId,
  computeAvailableContexts,
} from '../authz/personal-context.js';
import type {
  Principal,
  ActiveContext,
  MeResponse,
} from '@nestself/contracts';

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
    return {
      principal,
      effectiveActions: [],
      availableContexts: computeAvailableContexts(loaded),
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
      // Non-personal: original validation logic.
      const contextAllowed =
        (newContext.kind === 'organization' &&
          loaded.memberships.some(
            (m) => m.orgId === newContext.orgId && m.status === 'ACTIVE',
          )) ||
        (newContext.kind === 'expert' && loaded.expert != null) ||
        (newContext.kind === 'operations' && loaded.staffTemplates.length > 0);
      if (!contextAllowed) {
        throw new ApiHttpException({
          status: 403,
          code: 'invalid_context',
          message: 'The requested context is not available to this user',
        });
      }
    }

    const population = this.resolvePopulation(loaded, resolvedContext);
    await this.sessions.updateContext(sessionId, resolvedContext, population);

    return {
      principal: { ...principal, context: resolvedContext },
      effectiveActions: [],
      availableContexts: computeAvailableContexts(loaded),
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

  private resolvePopulation(
    loaded: { staffTemplates: unknown[]; expert: unknown | null },
    context: ActiveContext,
  ): 'employee' | 'expert' | 'staff' {
    if (loaded.staffTemplates.length > 0) return 'staff';
    if (loaded.expert && context.kind === 'expert') return 'expert';
    return 'employee';
  }
}
