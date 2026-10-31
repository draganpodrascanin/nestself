import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationGuard } from './authentication.guard.js';
import { BEARER_VERIFIER } from './bearer-verifier.js';
import { StubBearerVerifier } from './stub-bearer-verifier.js';
import { CognitoBearerVerifier } from './cognito-bearer-verifier.js';
import { AuthController } from './auth.controller.js';
import { DiscoverService } from './discover.service.js';
import { SignInService } from './sign-in.service.js';
import { IdentityResolutionService } from './identity-resolution.service.js';
import { TotpService } from './totp.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { SessionEndpointsService } from './session-endpoints.service.js';
import { ChallengeStore } from './challenge-store.js';
import { SignInThrottle } from './sign-in-throttle.js';
import { StepUpThrottle } from './step-up-throttle.js';
import { AccessRevocationService } from './access-revocation.service.js';
import { ProfileService } from './profile.service.js';
import { StepUpService } from './step-up.service.js';
import { NestselfOtpService } from './nestself-otp.service.js';
import { AuthorizationGuard } from '../authz/authorization.guard.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { ContextLoader } from '../authz/context-loader.js';
import { MeResponseBuilder } from './me-response.builder.js';
import { SessionModule } from '../session/session.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { KEY_VALUE_STORE } from '../redis/key-value-store.js';
import { SsoCallbackService } from './sso-callback.service.js';
import { FederatedBindingService } from './federated-binding.service.js';
import { InvitationMembershipActivator } from '../invitations/invitation-membership-activator.js';

@Module({
  imports: [SessionModule, IdentityModule],
  controllers: [AuthController],
  providers: [
    AuthenticationGuard,
    {
      provide: BEARER_VERIFIER,
      inject: [ConfigService, JwtService, KEY_VALUE_STORE],
      useFactory: (config: ConfigService, jwt: JwtService, store: unknown) => {
        const authMode = config.get<string>('AUTH_MODE', 'stub');
        if (authMode === 'cognito') {
          return new CognitoBearerVerifier(config, store as never);
        }
        return new StubBearerVerifier(jwt);
      },
    },
    DiscoverService,
    SignInService,
    IdentityResolutionService,
    TotpService,
    PasswordResetService,
    SessionEndpointsService,
    ChallengeStore,
    SignInThrottle,
    StepUpThrottle,
    AccessRevocationService,
    ProfileService,
    MeResponseBuilder,
    StepUpService,
    NestselfOtpService,
    FederatedBindingService,
    SsoCallbackService,
    InvitationMembershipActivator,
    AuthorizationGuard,
    AuthorizationService,
    ContextLoader,
  ],
  exports: [
    AuthenticationGuard,
    BEARER_VERIFIER,
    SignInService,
    DiscoverService,
    IdentityResolutionService,
    AuthorizationGuard,
    AuthorizationService,
    ContextLoader,
    AccessRevocationService,
    InvitationMembershipActivator,
    NestselfOtpService,
  ],
})
export class AuthModule {}
