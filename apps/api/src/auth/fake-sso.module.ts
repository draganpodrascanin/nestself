/**
 * FakeSsoModule: the stub-only fake IdP authorize route. AppModule imports it
 * through `ConditionalModule.registerWhen` so it exists only with
 * `AUTH_MODE=stub` (the default).
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { FakeSsoAuthorizeController } from './fake-sso-authorize.controller.js';

@Module({
  imports: [IdentityModule],
  controllers: [FakeSsoAuthorizeController],
})
export class FakeSsoModule {}

/** `ConditionalModule` predicate: stub mode, which is also the default. */
export function isStubAuthMode(env: NodeJS.ProcessEnv): boolean {
  return (env.AUTH_MODE ?? 'stub') === 'stub';
}
