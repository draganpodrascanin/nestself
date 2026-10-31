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
  defaultContext,
  resolvePopulation,
} from '../authz/personal-context.js';
import type {
  Principal,
  MeResponse,
} from '@nestself/contracts';
import type { AuthMethod } from '../session/session.types.js';
import { MeResponseBuilder } from './me-response.builder.js';

/** Exported so sign-in.service can use it. */
export type SessionCreationResult = MeResponse & {
  sessionId: string;
  absoluteExpiresAt: Date;
  csrfToken: string;
};

/** Pool-native Cognito users. */
export const NATIVE_PROVIDER = 'cognito';

/**
 * `external_identities.provider` of a federated Cognito user (D-04):
 * `cognito:<providerName>`, the provider being the SSO connection's
 * `cognitoProviderName`.
 */
export function federatedProvider(providerName: string): string {
  return `${NATIVE_PROVIDER}:${providerName}`;
}

export function authMethodFromOutcome(
  _outcome: AuthOutcome,
  wasPassword: boolean,
  /** Tokens from the SSO code flow (3.4.9: MFA delegated to the IdP). */
  federated = false,
): AuthMethod {
  if (federated) return 'sso';
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
    @Inject(forwardRef(() => MeResponseBuilder)) private readonly meResponse: MeResponseBuilder,
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
    /**
     * Set for the SSO callback: the identity is looked up under
     * `cognito:<providerName>` and the session records `auth.method = 'sso'`.
     */
    federatedProviderName?: string,
  ): Promise<SessionCreationResult> {
    const { decodeJwtClaims } = await import('../identity/identity-provider.service.js');
    const claims = decodeJwtClaims(tokens.idToken);
    const sub = claims.sub ?? '';
    const provider = federatedProviderName ? federatedProvider(federatedProviderName) : NATIVE_PROVIDER;

    const identity = await this.identities.findExternalIdentity(provider, sub);

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

    const context = defaultContext(loaded);
    const population = resolvePopulation(loaded, context);
    const authMethod = authMethodFromOutcome({ kind: 'tokens', tokens }, wasPassword, !!federatedProviderName);

    const { sessionId, csrfToken, absoluteExpiresAt } =
      await this.sessions.create({
        userId: identity.userId,
        surface,
        population,
        context,
        // A real Cognito ID token carries the pool username as `cognito:username`
        // and has no `username` claim (that one is on the access token).
        cognitoUsername: claims['cognito:username'] ?? claims.username ?? sub,
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

    // Only a native sign-in consumed the email-code throttle. A federated one
    // never did, and its address is the IdP's assertion, not checked against
    // the connection's verified domains on this path: it must not reset the
    // throttle of whatever address the IdP names.
    if (!federatedProviderName) await this.throttle.reset(email);

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
    return this.meResponse.build(principal);
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
      case 'provider_exists':
        return new ApiHttpException({
          status: 409, code: 'conflict',
          message: 'An identity provider with this name already exists',
        });
      case 'provider_not_found':
        return new ApiHttpException({
          status: 404, code: 'not_found',
          message: 'Identity provider not found',
        });
      case 'unavailable':
        return new ApiHttpException({
          status: 503, code: 'unavailable',
          message: 'The identity provider is unavailable. Try again later.',
        });
      default:
        return new ApiHttpException({
          status: 500, code: 'unauthenticated', message: err.message,
        });
    }
  }
}
