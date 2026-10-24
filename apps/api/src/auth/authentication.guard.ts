/**
 * Global AuthenticationGuard -- session cookie + bearer token.
 *
 * @Public() routes bypass the guard entirely.
 * Attaches request.principal, request.session, request.authMeta, request.csrfToken.
 *
 * @see D-19, D-36, T-1.6
 */
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
 
import { Reflector } from '@nestjs/core';
 
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../authz/public.decorator.js';
import { BEARER_VERIFIER, type BearerVerifier } from './bearer-verifier.js';
 
import {
  PrincipalLoader,
  type LoadedPrincipal,
} from '../principal/principal-loader.js';
 
import { SessionService } from '../session/session.service.js';
 
import { SessionCookies } from '../session/session-cookie.js';
 
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { ApiHttpException } from '../common/api-error.js';
import { requestMeta, type RequestMeta } from '../common/request-meta.js';
import type { SessionRecord } from '../session/session.types.js';
import { defaultContext } from '../authz/personal-context.js';
import type { Principal, ActiveContext, AuthInfo } from '@nestself/contracts';
import {
  userMobileFamiliesKey,
  MOBILE_FAMILY_TTL,
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

    // Resolve userId
    let userId = payload.userId;
    if (!userId) {
      // Look up via ExternalIdentity
      const identity = await this.identities.findExternalIdentity('cognito', payload.sub);
      if (!identity) {
        throw new ApiHttpException({
          status: 401,
          code: 'unauthenticated',
          message: 'No linked identity found',
        });
      }
      userId = identity.userId;
    }

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
    const context = defaultContext(loaded);

    const principal = this.assemblePrincipal(loaded, {
      context,
      auth: {
        method: payload.authMethod,
        time: new Date(payload.authTime * 1000).toISOString(),
        secondFactor: false,
        lastStepUpAt: null,
      },
      sessionId: null,
      tokenFamily: payload.originJti,
    });

    req.principal = principal;
    return true;
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

  // defaultContext is now imported from personal-context.ts (ruling 9, T-C1.02).
}
