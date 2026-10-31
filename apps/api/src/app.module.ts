import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthenticationGuard } from './auth/authentication.guard.js';
import { AuthorizationGuard } from './authz/authorization.guard.js';
import { CsrfGuard } from './session/csrf.guard.js';
import { ProgrammeModule } from './programme/programme.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { RedisModule } from './redis/redis.module.js';
import { KEY_VALUE_STORE } from './redis/key-value-store.js';
import { AppThrottlerGuard } from './common/app-throttler.guard.js';
import { throttlerModuleOptions } from './common/throttler-options.js';
import { IdentityModule } from './identity/identity.module.js';
import { SessionModule } from './session/session.module.js';
import { AuditModule } from './audit/audit.module.js';
import { PrincipalModule } from './principal/principal.module.js';
import { PINO_REDACT_CONFIG } from './audit/pino-redaction.js';
import { MailerModule } from './mailer/mailer.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { MembersModule } from './members/members.module.js';
import { UsersModule } from './users/users.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { OrgUnitsModule } from './org-units/org-units.module.js';
import { GrantsModule } from './grants/grants.module.js';
import { WsModule } from './ws/ws.module.js';
import { ProfessionalModule } from './professional/professional.module.js';
import { EmergencyModule } from './emergency/emergency.module.js';
import { MediaModule } from './media/media.module.js';
import { CmsModule } from './cms/cms.module.js';
import { LibraryModule } from './library/library.module.js';
import { VideoModule } from './video/video.module.js';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { CallsModule } from './calls/calls.module.js';
import { CallsJobsModule } from './jobs/calls-jobs.module.js';
import { WebinarsModule } from './webinars/webinars.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { SsoModule } from './sso/sso.module.js';
import { FakeSsoModule, isStubAuthMode } from './auth/fake-sso.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Tests set their environment explicitly; never let a developer's .env
      // (for example REDIS_URL) leak into them.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          transport:
            config.get('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty' }
              : undefined,
          redact: PINO_REDACT_CONFIG,
        },
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '1h') as `${number}${'s' | 'm' | 'h' | 'd'}`,
        },
      }),
    }),
    // Counters in Redis when REDIS_URL is set, else the in-memory default (5.9).
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, KEY_VALUE_STORE],
      useFactory: throttlerModuleOptions,
    }),
    DbModule,
    RedisModule,
    IdentityModule,
    SessionModule,
    AuditModule,
    PrincipalModule,
    HealthModule,
    AuthModule,
    ProgrammeModule,
    LeadsModule,
    MailerModule,
    InvitationsModule,
    MembersModule,
    UsersModule,
    JobsModule,
    OrgUnitsModule,
    GrantsModule,
    ProfessionalModule,
    EmergencyModule,
    VideoModule,
    AppointmentsModule,
    CallsModule,
    CallsJobsModule,
    WebinarsModule,
    OrganizationsModule,
    SsoModule,
    // Stub-only fake IdP authorize route (D-12); absent with AUTH_MODE=cognito.
    ConditionalModule.registerWhen(FakeSsoModule, isStubAuthMode),
    WsModule,
    MediaModule.register(),
    CmsModule,
    LibraryModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
