import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { IdentityModule } from './identity/identity.module.js';
import { SessionModule } from './session/session.module.js';
import { AuditModule } from './audit/audit.module.js';
import { PrincipalModule } from './principal/principal.module.js';
import { PINO_REDACT_CONFIG } from './audit/pino-redaction.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { MembersModule } from './members/members.module.js';
import { UsersModule } from './users/users.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { OrgUnitsModule } from './org-units/org-units.module.js';
import { GrantsModule } from './grants/grants.module.js';
import { WsModule } from './ws/ws.module.js';
import { ProfessionalModule } from './professional/professional.module.js';
import { EmergencyModule } from './emergency/emergency.module.js';
import { VideoModule } from './video/video.module.js';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { CallsModule } from './calls/calls.module.js';

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
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }),
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
    WsModule,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: AuthorizationGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
