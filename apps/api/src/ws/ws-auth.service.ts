/**
 * WsAuthService — authenticates WebSocket handshakes.
 *
 * Two paths:
 *   1. Web (cookie):  parse session cookie → load session → load principal
 *   2. Mobile (ticket): hash ticket → GETDEL from Redis → load principal
 *
 * Pure-ish: all I/O is injected.  Unit-testable with mocks.
 *
 * @see AUTHZ-R-58, AUTHZ-R-60, T-1.11
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { SessionService } from '../session/session.service.js';
import { SessionCookies } from '../session/session-cookie.js';
import {
  PrincipalLoader,
  type LoadedPrincipal,
} from '../principal/principal-loader.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import { wsTicketKey, WS_TICKET_TTL } from '../redis/redis-keys.js';
import type { Principal, ActiveContext, AuthInfo } from '@nestself/contracts';

export class WsAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unauthorized'
      | 'forbidden_origin'
      | 'invalid_ticket',
  ) {
    super(message);
    this.name = 'WsAuthError';
  }
}

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    @Inject(forwardRef(() => SessionService))
    private readonly sessions: SessionService,
    @Inject(forwardRef(() => SessionCookies))
    private readonly cookies: SessionCookies,
    @Inject(forwardRef(() => PrincipalLoader))
    private readonly principalLoader: PrincipalLoader,
    @Inject(KEY_VALUE_STORE)
    private readonly store: KeyValueStore,
  ) {}

  /**
   * Authenticate a Socket.IO handshake.
   *
   * @param headers  - The HTTP headers from the handshake request.
   * @param auth     - The `handshake.auth` object (mobile sends `{ ticket }`).
   * @param origin   - The Origin header value (null when absent).
   * @param allowedOrigins - Allowed origin URLs (WORKSPACE_URL, ADMIN_URL).
   * @returns The authenticated Principal.
   * @throws {WsAuthError} on failure.
   */
  async authenticateHandshake(
    headers: Record<string, string | undefined>,
    auth: Record<string, unknown>,
    origin: string | null,
    allowedOrigins: string[],
  ): Promise<Principal> {
    // -----------------------------------------------------------------------
    // Origin check (when an Origin header is present)
    // -----------------------------------------------------------------------
    if (origin) {
      const allowed = allowedOrigins.some(
        (o) => o && origin === o,
      );
      if (!allowed) {
        throw new WsAuthError(
          `Origin ${origin} is not allowed`,
          'forbidden_origin',
        );
      }
    }

    // -----------------------------------------------------------------------
    // Mobile ticket path
    // -----------------------------------------------------------------------
    const ticket = auth?.ticket;
    if (typeof ticket === 'string' && ticket.length > 0) {
      return this.authenticateViaTicket(ticket);
    }

    // -----------------------------------------------------------------------
    // Web cookie path
    // -----------------------------------------------------------------------
    return this.authenticateViaCookie(headers);
  }

  // -------------------------------------------------------------------------
  // Cookie path
  // -------------------------------------------------------------------------

  private async authenticateViaCookie(
    headers: Record<string, string | undefined>,
  ): Promise<Principal> {
    const { sessionId } = this.cookies.parse(headers);
    if (!sessionId) {
      throw new WsAuthError(
        'Missing session cookie',
        'unauthorized',
      );
    }

    const record = await this.sessions.get(sessionId);
    if (!record) {
      throw new WsAuthError(
        'Session not found or expired',
        'unauthorized',
      );
    }

    const loaded = await this.principalLoader.load(record.userId);
    if (!loaded) {
      throw new WsAuthError('User not found', 'unauthorized');
    }

    if (loaded.isSuspended || loaded.isDeactivated) {
      throw new WsAuthError(
        'Account is suspended or deactivated',
        'unauthorized',
      );
    }

    return this.assemblePrincipal(loaded, {
      context: record.context,
      auth: {
        method: record.auth.method,
        time: record.auth.time,
        secondFactor: record.auth.secondFactor,
        lastStepUpAt: record.lastStepUpAt,
      },
      sessionId: record.sessionId,
      tokenFamily: null,
    });
  }

  // -------------------------------------------------------------------------
  // Ticket path
  // -------------------------------------------------------------------------

  private async authenticateViaTicket(ticket: string): Promise<Principal> {
    const hash = createHash('sha256').update(ticket).digest('hex');
    const raw = await this.store.getDel(wsTicketKey(hash));

    if (!raw) {
      throw new WsAuthError(
        'Invalid or already used ticket',
        'invalid_ticket',
      );
    }

    let data: { userId: string; createdAt: string; auth?: AuthInfo | null };
    try {
      data = JSON.parse(raw) as { userId: string; createdAt: string; auth?: AuthInfo | null };
    } catch {
      throw new WsAuthError('Malformed ticket payload', 'invalid_ticket');
    }

    // Reject tickets older than 30 s
    const age =
      (Date.now() - new Date(data.createdAt).getTime()) / 1000;
    if (age > WS_TICKET_TTL) {
      throw new WsAuthError('Ticket has expired', 'invalid_ticket');
    }

    const loaded = await this.principalLoader.load(data.userId);
    if (!loaded) {
      throw new WsAuthError('User not found', 'unauthorized');
    }

    if (loaded.isSuspended || loaded.isDeactivated) {
      throw new WsAuthError(
        'Account is suspended or deactivated',
        'unauthorized',
      );
    }

    // Default context for ticket/bearer callers (same logic as AuthenticationGuard)
    const context = this.defaultContext(loaded);

    // Carry the issuing session's authentication strength (never upgrade it).
    return this.assemblePrincipal(loaded, {
      context,
      auth: data.auth ?? {
        method: 'email_otp',
        time: new Date().toISOString(),
        secondFactor: false,
        lastStepUpAt: null,
      },
      sessionId: null,
      tokenFamily: null,
    });
  }

  // -------------------------------------------------------------------------
  // Shared helpers (copied from AuthenticationGuard to keep it unmodified)
  // -------------------------------------------------------------------------

  private assemblePrincipal(
    loaded: LoadedPrincipal,
    extra: {
      context: ActiveContext;
      auth: AuthInfo;
      sessionId: string | null;
      tokenFamily: string | null;
    },
  ): Principal {
    return {
      userId: loaded.userId,
      displayName: loaded.displayName,
      initials: loaded.initials,
      locale: loaded.locale,
      memberships: loaded.memberships,
      staffTemplates: loaded.staffTemplates,
      expert: loaded.expert,
      context: extra.context,
      auth: extra.auth,
      sessionId: extra.sessionId,
      tokenFamily: extra.tokenFamily,
    };
  }

  private defaultContext(loaded: LoadedPrincipal): ActiveContext {
    if (loaded.staffTemplates.length > 0) {
      return { kind: 'operations' };
    }
    if (loaded.expert) {
      return { kind: 'expert' };
    }
    const activeMembership = loaded.memberships.find(
      (m) => m.status === 'ACTIVE',
    );
    if (activeMembership) {
      return { kind: 'organization', orgId: activeMembership.orgId };
    }
    return { kind: 'personal' };
  }
}
