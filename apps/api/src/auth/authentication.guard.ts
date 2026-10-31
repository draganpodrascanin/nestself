/**
 * Global AuthenticationGuard -- session cookie + bearer token.
 *
 * @Public() routes bypass the guard entirely.
 * Attaches request.principal, request.session, request.authMeta, request.csrfToken.
 *
 * A bearer names its user by the pool `username`: a federated user's is
 * `<cognitoProviderName>_<IdP subject>` (provider names `org-<slug>-saml|oidc`
 * hold no `_`), a native user's is the email address. When the part before
 * the first `_` is the provider name of a connection, the bearer is
 * federated: its identity is looked up under `cognito:<provider>` by `sub`
 * and must pass path 1 exactly as the SSO callback runs it
 * (`FederatedBindingService.existingIdentityUsable`: bound through that very
 * connection, an ACTIVE member of its organization), else 401
 * `unauthenticated` with `auth.sign_in.failed { reason:
 * 'sso_provider_mismatch' }`, and no native fallback. That row is written
 * once per connection and pool user in `BEARER_MISMATCH_AUDIT_TTL`: this
 * guard runs before the throttler, so a valid access token of a pool user
 * without a usable identity (a mobile sign-in still to be confirmed on the
 * web, an ended membership) would otherwise write one per request; every
 * request is still refused. The principal records `method: 'sso'` and
 * `secondFactor: true` (MFA delegated to the IdP, as for a federated web
 * session). Any other bearer resolves natively as before.
 *
 * @see D-19, D-36, T-1.6, phase 4 design 5.7
 */
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
 
import { Reflector } from '@nestjs/core';
 
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../authz/public.decorator.js';
import { BEARER_VERIFIER, type BearerPayload, type BearerVerifier } from './bearer-verifier.js';
import { FederatedBindingService } from './federated-binding.service.js';
import { NATIVE_PROVIDER, federatedProvider } from './identity-resolution.service.js';
 
import {
  PrincipalLoader,
  type LoadedPrincipal,
} from '../principal/principal-loader.js';
 
import { SessionService } from '../session/session.service.js';
 
import { SessionCookies } from '../session/session-cookie.js';
 
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { SsoRepository, type SsoConnectionRow } from '../db/repositories/sso.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
import { requestMeta, type RequestMeta } from '../common/request-meta.js';
import { hasProviderNameShape } from '../sso/provider-name.js';
import type { SessionRecord } from '../session/session.types.js';
import type { Principal, ActiveContext, AuthInfo } from '@nestself/contracts';
import {
  userMobileFamiliesKey,
  MOBILE_FAMILY_TTL,
  BEARER_MISMATCH_AUDIT_TTL,
  bearerMismatchAuditedKey,
} from '../redis/redis-keys.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';

/** Minimal Express-compatible request shape. */
interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  id?: string;
  principal?: Principal;
  session?: SessionRecord;
  authMeta?: RequestMeta;
  csrfToken?: string;
  stepUpClass?: string;
}

/**
 * The provider name a pool username starts with: what precedes the first
 * `_` (provider names hold none), when it has the shape of a provider name
 * (`org-<slug>-saml|oidc`, {@link hasProviderNameShape}). A native username,
 * an email address, may hold a `_` too: one whose prefix has another shape is
 * native without a database lookup, and for the rest the caller still has to
 * find a connection by that name.
 */
function providerPrefix(username: string | undefined): string | null {
  if (!username) return null;
  const at = username.indexOf('_');
  if (at <= 0) return null;
  const prefix = username.slice(0, at);
  return hasProviderNameShape(prefix) ? prefix : null;
}

function unauthenticated(message: string): ApiHttpException {
  return new ApiHttpException({ status: 401, code: 'unauthenticated', message });
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly logger = new Logger(AuthenticationGuard.name);
  private readonly trustProxyHops: number;

  constructor(
    @Inject(forwardRef(() => Reflector)) private readonly reflector: Reflector,
    @Inject(forwardRef(() => ConfigService)) private readonly config: ConfigService,
    @Inject(BEARER_VERIFIER) private readonly bearer: BearerVerifier,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => SessionService)) private readonly sessions: SessionService,
    @Inject(forwardRef(() => SessionCookies)) private readonly cookies: SessionCookies,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
    @Inject(forwardRef(() => FederatedBindingService)) private readonly binding: FederatedBindingService,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
  ) {
    this.trustProxyHops = config.get<number>('TRUST_PROXY_HOPS', 0);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<HttpReq>();
    const meta = requestMeta(
      req as Parameters<typeof requestMeta>[0],
      this.trustProxyHops,
    );
    req.authMeta = meta;

    // 1. Try session cookie
    const { sessionId } = this.cookies.parse(
      req.headers as Record<string, string | undefined>,
    );
    if (sessionId) {
      return this.authenticateViaSession(req, sessionId);
    }

    // 2. Try bearer token
    const authHeader = req.headers['authorization'];
    const headerStr = typeof authHeader === 'string' ? authHeader : undefined;
    if (headerStr?.startsWith('Bearer ')) {
      return this.authenticateViaBearer(req, headerStr.slice(7));
    }

    throw new ApiHttpException({
      status: 401,
      code: 'unauthenticated',
      message: 'Missing authentication credentials',
    });
  }

  private async authenticateViaSession(
    req: HttpReq,
    sessionId: string,
  ): Promise<boolean> {
    const stored = await this.sessions.get(sessionId);
    if (!stored) {
      throw new ApiHttpException({
        status: 401,
        code: 'session_expired',
        message: 'Session not found or expired',
      });
    }
    // Refresh the Cognito access token when it is about to expire (3.6.5);
    // a failed refresh destroys the session and surfaces session_expired.
    const record = await this.sessions.ensureFreshAccessToken(stored);

    const loaded = await this.principalLoader.load(record.userId);
    if (!loaded) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'User not found',
      });
    }

    if (loaded.isSuspended || loaded.isDeactivated) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'Account is suspended or deactivated',
      });
    }

    const principal = this.assemblePrincipal(loaded, {
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

    req.principal = principal;
    req.session = record;
    req.csrfToken = record.csrfToken;
    return true;
  }

  private async authenticateViaBearer(
    req: HttpReq,
    token: string,
  ): Promise<boolean> {
    const payload = await this.bearer.verify(token);
    const { userId, federated } = await this.resolveBearerUser(payload, req.authMeta);

    // Track mobile family (AUTHZ-R-64)
    if (payload.originJti) {
      try {
        await this.store.sAdd(
          userMobileFamiliesKey(userId),
          payload.originJti,
        );
        await this.store.expire(
          userMobileFamiliesKey(userId),
          MOBILE_FAMILY_TTL,
        );
      } catch {
        // Non-critical
      }
    }

    const loaded = await this.principalLoader.load(userId);
    if (!loaded) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'User not found',
      });
    }

    if (loaded.isSuspended || loaded.isDeactivated) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'Account is suspended or deactivated',
      });
    }

    // Determine default context for bearer callers
    const context = this.defaultContext(loaded);

    const principal = this.assemblePrincipal(loaded, {
      context,
      auth: {
        // A federated sign-in's MFA is delegated to the IdP (3.4.9), as for a federated session.
        method: federated ? 'sso' : payload.authMethod,
        time: new Date(payload.authTime * 1000).toISOString(),
        secondFactor: federated,
        lastStepUpAt: null,
      },
      sessionId: null,
      tokenFamily: payload.originJti,
    });

    req.principal = principal;
    return true;
  }

  /**
   * The user a bearer belongs to. A username whose prefix is a connection's
   * provider name is a federated pool user, trusted only through path 1 of
   * that connection (Review Focus 3: a provider name that belongs to another
   * organization than the identity's binding connection vouches for nothing).
   * Everything else resolves natively, as before.
   */
  private async resolveBearerUser(
    payload: BearerPayload,
    meta: RequestMeta | undefined,
  ): Promise<{ userId: string; federated: boolean }> {
    const prefix = providerPrefix(payload.username);
    const connection = prefix ? await this.sso.findConnectionByProviderName(prefix) : null;
    if (prefix && connection) {
      const identity = await this.identities.findExternalIdentity(federatedProvider(prefix), payload.sub);
      if (!identity || !(await this.binding.existingIdentityUsable(identity, connection))) {
        await this.auditProviderMismatch(connection, payload.sub, meta);
        throw unauthenticated('No identity bound through this connection');
      }
      return { userId: identity.userId, federated: true };
    }

    if (payload.userId) return { userId: payload.userId, federated: false };
    const identity = await this.identities.findExternalIdentity(NATIVE_PROVIDER, payload.sub);
    if (!identity) throw unauthenticated('No linked identity found');
    return { userId: identity.userId, federated: false };
  }

  /**
   * `auth.sign_in.failed { reason: 'sso_provider_mismatch' }` for a refused
   * federated bearer, once per connection and pool user in
   * `BEARER_MISMATCH_AUDIT_TTL`: no throttle sees a request this guard
   * refuses, so the row must not cost an insert per request. The key holds a
   * hash of the `sub`, an identifier from a token. When the store cannot
   * answer, the row is written (the dedupe fails open; the caller's 401
   * never does). Awaited; a failed write is swallowed (logged by the writer).
   */
  private async auditProviderMismatch(
    connection: SsoConnectionRow,
    sub: string,
    meta: RequestMeta | undefined,
  ): Promise<void> {
    const key = bearerMismatchAuditedKey(connection.id, createHash('sha256').update(sub).digest('hex'));
    let firstInWindow = true;
    try {
      firstInWindow = await this.store.set(key, '1', { ttlSeconds: BEARER_MISMATCH_AUDIT_TTL, onlyIfAbsent: true });
    } catch {
      // The store is unavailable: keep the signal.
    }
    if (!firstInWindow) return;
    await this.audit
      .record({
        action: 'auth.sign_in.failed',
        actorUserId: null,
        actorKind: 'USER',
        orgId: connection.orgId,
        recordType: 'auth_attempt',
        recordId: connection.cognitoProviderName,
        result: 'DENIED',
        ip: meta?.ip ?? null,
        userAgent: meta?.userAgent ?? null,
        details: { reason: 'sso_provider_mismatch' },
      })
      .catch(() => {});
  }

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
