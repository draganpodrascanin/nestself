/**
 * SsoModule: enterprise SSO connection management (D-12, 3.4).
 *
 * DNS verification uses the authoritative resolver with AUTH_MODE=cognito
 * and the in-memory fake in stub mode; tests reach the fake through
 * `app.get(DNS_TXT_RESOLVER)`. In stub mode `FAKE_DNS_TXT_AUTOVERIFY=true`
 * answers every pending domain with its expected record (Playwright).
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SsoRepository } from '../db/repositories/sso.repository.js';
import {
  AuthoritativeDnsTxtResolver,
  DNS_TXT_RESOLVER,
  FakeDnsTxtResolver,
  type DnsTxtResolver,
} from './dns-txt-resolver.js';
import { SsoConnectionsController } from './sso-connections.controller.js';
import {
  SSO_CONFIG,
  SsoConnectionsService,
  TXT_RECORD_PREFIX,
  spMetadataFor,
  txtRecordValue,
  type SsoConfig,
} from './sso-connections.service.js';

export const DEFAULT_API_PUBLIC_URL = 'http://localhost:4000';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [SsoConnectionsController],
  providers: [
    SsoConnectionsService,
    {
      provide: SSO_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SsoConfig => ({
        apiPublicUrl: (config.get<string>('API_PUBLIC_URL') ?? DEFAULT_API_PUBLIC_URL).replace(/\/+$/, ''),
        spMetadata: spMetadataFor(config.get<string>('COGNITO_USER_POOL_ID'), config.get<string>('COGNITO_DOMAIN')),
      }),
    },
    {
      provide: DNS_TXT_RESOLVER,
      inject: [ConfigService, SsoRepository],
      useFactory: (config: ConfigService, repo: SsoRepository): DnsTxtResolver => {
        if (config.get<string>('AUTH_MODE', 'stub') === 'cognito') return new AuthoritativeDnsTxtResolver();
        const autoVerify = config.get<boolean | string>('FAKE_DNS_TXT_AUTOVERIFY');
        if (autoVerify !== true && autoVerify !== 'true') return new FakeDnsTxtResolver();
        return new FakeDnsTxtResolver(async (name) => {
          if (!name.startsWith(TXT_RECORD_PREFIX)) return [];
          const domain = await repo.findDomainByName(name.slice(TXT_RECORD_PREFIX.length));
          return domain ? [txtRecordValue(domain.verificationToken)] : [];
        });
      },
    },
  ],
  exports: [SsoConnectionsService],
})
export class SsoModule {}
