/**
 * Identity module: provides IdentityProviderService.
 *
 * When AUTH_MODE=cognito, the Cognito adapter is used.
 * Otherwise the FakeIdentityProvider is used for local development.
 *
 * @see D-12, D-36, T-1.15
 */
import { Module } from '@nestjs/common';
 
import { ConfigService } from '@nestjs/config';
import { IdentityProviderService } from './identity-provider.service.js';
import { CognitoIdentityProvider } from './cognito-identity-provider.js';
import { FakeIdentityProvider } from './fake-identity-provider.js';
import { SAMPLE_EXTERNAL_IDENTITIES, SAMPLE_DEV_PASSWORD } from '@nestself/sample-data';

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
          );
        }
        const fake = new FakeIdentityProvider();
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
  ],
  exports: [IdentityProviderService],
})
export class IdentityModule {}
