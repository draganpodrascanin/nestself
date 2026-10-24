/**
 * IdentityResolutionService -- resolves IdP tokens to a local user, creates
 * sessions, and builds the MeResponse payload.
 *
 * @see T-1.4, SESS-R-09
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
 
import { SessionService } from '../session/session.service.js';
 
import {
  PrincipalLoader,
  type LoadedPrincipal,
} from '../principal/principal-loader.js';
 
import { AuditWriter } from '../audit/audit-writer.js';
 
import { IdentityRepository } from '../db/repositories/identity.repository.js';
 
import { SignInThrottle } from './sign-in-throttle.js';
import type {
  IdentityProviderError,
} from '../identity/identity-provider.service.js';
import type {
  AuthOutcome,
  TokenSet,
} from '../identity/identity-provider.service.js';
import { ApiHttpException } from '../common/api-error.js';
import {
  resolveDefaultPersonalOrgId,
  computeAvailableContexts,
} from '../authz/personal-context.js';
import type {
  Principal,
  ActiveContext,
  MeResponse,
} from '@nestself/contracts';
import type { AuthMethod } from '../session/session.types.js';

/** Exported so sign-in.service can use it. */
export type SessionCreationResult = MeResponse & {
  sessionId: string;
  absoluteExpiresAt: Date;
  csrfToken: string;
};

export function authMethodFromOutcome(
  _outcome: AuthOutcome,
  wasPassword: boolean,
): AuthMethod {
  if (wasPassword) return 'password_totp';
  return 'email_otp';
}

@Injectable()
export class IdentityResolutionService {
  constructor(
    @Inject(forwardRef(() => SessionService)) private readonly sessions: SessionService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => SignInThrottle)) private readonly throttle: SignInThrottle,
  ) {}

  /** Resolve a token-bearing outcome into a session + MeResponse. */
  async resolveOutcome(
    outcome: AuthOutcome,
    email: string,
    surface: 'workspace' | 'admin',
    meta: { ip: string | null; userAgent: string | null },
    wasPassword: boolean,
    /** True only when a TOTP code or MFA enrolment was verified in this sign-in. */
    secondFactor = false,
  ): Promise<SessionCreationResult> {
    if (outcome.kind !== 'tokens') {
      throw new ApiHttpException({
        status: 500,
        code: 'unauthenticated',
        message: 'Unexpected auth outcome',
      });
    }
    return this.resolveIdentityAndCreateSession(
      outcome.tokens, email, surface, meta, wasPassword, secondFactor,
    );
  }

  async resolveIdentityAndCreateSession(
    tokens: TokenSet,
    email: string,
    surface: 'workspace' | 'admin',
    meta: { ip: string | null; userAgent: string | null },
    wasPassword: boolean,
    secondFactor = false,
  ): Promise<SessionCreationResult> {
    const { decodeJwtClaims } = await import('../identity/identity-provider.service.js');
    const claims = decodeJwtClaims(tokens.idToken);
    const sub = claims.sub ?? '';

    const identity = await this.identities.findExternalIdentity('cognito', sub);

    if (!identity) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'No linked identity found. Complete onboarding first.',
      });
    }

    const loaded = await this.principalLoader.load(identity.userId);
    if (!loaded) {
      throw new ApiHttpException({
        status: 401, code: 'unauthenticated', message: 'User not found',
      });
    }

    if (loaded.isSuspended || loaded.isDeactivated) {
      throw new ApiHttpException({
        status: 401, code: 'unauthenticated',
        message: 'Account is suspended or deactivated',
      });
    }

    const context = this.defaultContext(loaded);
    const population = this.resolvePopulation(loaded, context);
    const authMethod = authMethodFromOutcome({ kind: 'tokens', tokens }, wasPassword);

    const { sessionId, csrfToken, absoluteExpiresAt } =
      await this.sessions.create({
        userId: identity.userId,
        surface,
        population,
        context,
        cognitoUsername: claims.username ?? sub,
        tokens: {
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          refreshToken: tokens.refreshToken ?? '',
          expiresIn: tokens.expiresIn,
        },
        auth: {
          method: authMethod,
          time: new Date().toISOString(),
          secondFactor,
        },
        rememberDevice: false,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

    await this.throttle.reset(email);

    const principal: Principal = {
      userId: loaded.userId,
      displayName: loaded.displayName,
      initials: loaded.initials,
      locale: loaded.locale,
      memberships: loaded.memberships,
      staffTemplates: loaded.staffTemplates,
      expert: loaded.expert,
      context,
      auth: {
        method: authMethod,
        time: new Date().toISOString(),
        secondFactor,
        lastStepUpAt: null,
      },
      sessionId,
      tokenFamily: null,
    };

    const me = await this.buildMeResponse(loaded, principal);
    this.auditSignInSucceeded(identity.userId, meta);
    return { ...me, sessionId, absoluteExpiresAt, csrfToken };
  }

  async buildMeResponse(
    loaded: LoadedPrincipal,
    principal: Principal,
  ): Promise<MeResponse> {
    const extras = await this.principalLoader.loadAvailableContextExtras(loaded);
    // Ruling F: compute effective actions from grants for the active context.
    const orgId =
      principal.context.kind === 'personal' ? principal.context.orgId
      : principal.context.kind === 'organization' ? principal.context.orgId
      : undefined;
    const grants = await this.principalLoader.loadGrants(principal.userId, orgId ?? '');
    const now = new Date();
    const actions = new Set<string>();
    for (const g of grants) {
      if (g.revokedAt != null) continue;
      if (g.validFrom != null && g.validFrom > now) continue;
      if (g.validUntil != null && g.validUntil <= now) continue;
      for (const a of g.actions) actions.add(a);
    }
    return {
      principal,
      effectiveActions: [...actions],
      availableContexts: computeAvailableContexts(loaded, extras),
    };
  }

  resolvePopulation(
    loaded: LoadedPrincipal,
    context: ActiveContext,
  ): 'employee' | 'expert' | 'staff' {
    if (loaded.staffTemplates.length > 0) return 'staff';
    if (loaded.expert && context.kind === 'expert') return 'expert';
    return 'employee';
  }

  defaultContext(loaded: LoadedPrincipal): ActiveContext {
    // Staff → operations, expert → expert, everyone else → personal (item 2).
    if (loaded.staffTemplates.length > 0) return { kind: 'operations' };
    if (loaded.expert) return { kind: 'expert' };
    // ACC-R-12: personal context carries a resolved orgId when possible.
    const orgId = resolveDefaultPersonalOrgId(loaded.memberships);
    return orgId ? { kind: 'personal', orgId } : { kind: 'personal' };
  }

  // -- Audit helpers (fire-and-forget) ----------------------------------------

  auditSignInSucceeded(
    userId: string,
    meta: { ip: string | null; userAgent: string | null },
  ): void {
    this.audit
      .record({
        action: 'auth.sign_in.succeeded',
        actorUserId: userId,
        actorKind: 'USER',
        recordType: 'session',
        recordId: userId,
        result: 'ALLOWED',
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => {});
  }

  auditSignInFailed(
    email: string,
    meta: { ip: string | null; userAgent: string | null },
  ): void {
    this.audit
      .record({
        action: 'auth.sign_in.failed',
        actorUserId: null,
        actorKind: 'USER',
        recordType: 'auth_attempt',
        recordId: email,
        result: 'DENIED',
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => {});
  }

  // -- Error mapping ----------------------------------------------------------

  mapIdpError(err: IdentityProviderError): ApiHttpException {
    switch (err.code) {
      case 'invalid_code':
        return new ApiHttpException({
          status: 401, code: 'invalid_code',
          message: 'Invalid verification code',
        });
      case 'invalid_credentials':
        return new ApiHttpException({
          status: 401, code: 'invalid_credentials',
          message: 'Invalid credentials',
        });
      case 'expired_session':
        return new ApiHttpException({
          status: 401, code: 'invalid_challenge',
          message: 'Challenge session expired',
        });
      case 'not_authorized':
        return new ApiHttpException({
          status: 401, code: 'invalid_challenge',
          message: 'Challenge could not be completed',
        });
      case 'too_many_attempts':
        return new ApiHttpException({
          status: 429, code: 'too_many_attempts',
          message: 'Too many attempts. Try again later.',
        });
      case 'user_not_found':
      case 'user_disabled':
        return new ApiHttpException({
          status: 401, code: 'invalid_credentials',
          message: 'Invalid credentials',
        });
      case 'password_policy':
        return new ApiHttpException({
          status: 400, code: 'validation',
          message: 'Password does not meet policy requirements',
        });
      case 'totp_already_enrolled':
        return new ApiHttpException({
          status: 409, code: 'totp_already_enrolled',
          message: 'TOTP is already enrolled',
        });
      default:
        return new ApiHttpException({
          status: 500, code: 'unauthenticated', message: err.message,
        });
    }
  }
}
