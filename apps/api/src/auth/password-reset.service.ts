import { Inject, Injectable, forwardRef } from '@nestjs/common';
 
import {
  IdentityProviderService,
  IdentityProviderError,
} from '../identity/identity-provider.service.js';
 
import { IdentityResolutionService } from './identity-resolution.service.js';
import { neutralDelay } from './neutral-delay.js';

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identity: IdentityResolutionService,
  ) {}

  async passwordResetStart(
    email: string,
  ): Promise<{ codeDeliveryMedium: 'EMAIL' }> {
    const start = Date.now();
    try {
      await this.idp.forgotPassword(email);
    } catch {
      // Neutral: don't reveal whether user exists
    }
    await neutralDelay(start);
    return { codeDeliveryMedium: 'EMAIL' };
  }

  async passwordResetConfirm(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ reset: true }> {
    try {
      await this.idp.confirmForgotPassword({ email, code, newPassword });
    } catch (err) {
      if (err instanceof IdentityProviderError) {
        throw this.identity.mapIdpError(err);
      }
      throw err;
    }
    return { reset: true };
  }
}
