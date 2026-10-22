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
        return new FakeIdentityProvider();
      },
    },
  ],
  exports: [IdentityProviderService],
})
export class IdentityModule {}
