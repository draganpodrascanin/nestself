/**
 * Identity module: provides IdentityProviderService and the SAML metadata
 * fetcher (`METADATA_FETCHER`).
 *
 * When AUTH_MODE=cognito, the Cognito adapter and the HTTPS metadata fetcher
 * are used. Otherwise the FakeIdentityProvider and the FakeMetadataFetcher
 * (no DNS, no network; tests reach it through `app.get(METADATA_FETCHER)`)
 * are used for local development.
 *
 * @see D-12, D-36, T-1.15
 */
import { Module } from '@nestjs/common';
 
import { ConfigService } from '@nestjs/config';
import { IdentityProviderService } from './identity-provider.service.js';
import { CognitoIdentityProvider } from './cognito-identity-provider.js';
import { FakeIdentityProvider } from './fake-identity-provider.js';
import { SAMPLE_EXTERNAL_IDENTITIES, SAMPLE_DEV_PASSWORD } from '@nestself/sample-data';
import {
  FakeMetadataFetcher,
  HttpsMetadataFetcher,
  METADATA_FETCHER,
  type MetadataFetcher,
} from '../sso/metadata-fetcher.js';

@Module({
  providers: [
    {
      provide: IdentityProviderService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const authMode = config.get<string>('AUTH_MODE', 'stub');
        if (authMode === 'cognito') {
          return new CognitoIdentityProvider(
            config.get<string>('COGNITO_REGION')!,
            config.get<string>('COGNITO_USER_POOL_ID')!,
            config.get<string>('COGNITO_WEB_CLIENT_ID')!,
            config.get<string>('COGNITO_WEB_CLIENT_SECRET')!,
            config.get<string>('COGNITO_MOBILE_CLIENT_ID')!,
            config.get<string>('COGNITO_DOMAIN')!,
          );
        }
        const fake = new FakeIdentityProvider({
          apiPublicUrl: config.get<string>('API_PUBLIC_URL'),
        });
        // Local development: the sample people exist in the fake pool with the
        // same subjects the database seed links (SAMPLE_EXTERNAL_IDENTITIES).
        // Tests seed their own users and skip this.
        if (config.get<string>('NODE_ENV') !== 'test') {
          fake.seedUsers(
            SAMPLE_EXTERNAL_IDENTITIES.map((identity) => ({
              email: identity.email,
              sub: identity.subject,
              username: identity.cognitoUsername,
              locale: 'sr-Latn',
              ...(identity.signIn === 'password' ? { password: SAMPLE_DEV_PASSWORD } : {}),
            })),
          );
        }
        return fake;
      },
    },
    {
      provide: METADATA_FETCHER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MetadataFetcher =>
        config.get<string>('AUTH_MODE', 'stub') === 'cognito' ? new HttpsMetadataFetcher() : new FakeMetadataFetcher(),
    },
  ],
  exports: [IdentityProviderService, METADATA_FETCHER],
})
export class IdentityModule {}
