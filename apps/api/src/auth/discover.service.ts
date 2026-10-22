/**
 * DiscoverService -- determines the sign-in method for a given email.
 *
 * @see T-1.4, API-R-01
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
 
import {
  IdentityProviderService,
} from '../identity/identity-provider.service.js';
import { neutralDelay } from './neutral-delay.js';
import type { DiscoverResponse } from '@nestself/contracts';

@Injectable()
export class DiscoverService {
  constructor(@Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService) {}

  async discover(email: string): Promise<DiscoverResponse> {
    const start = Date.now();
    const user = await this.idp.findUserByEmail(email);
    if (!user) {
      await neutralDelay(start);
      return { method: 'email_otp', ssoStartUrl: null, connection: null };
    }
    if (user.hasPassword) {
      return { method: 'password', ssoStartUrl: null, connection: null };
    }
    return { method: 'email_otp', ssoStartUrl: null, connection: null };
  }
}
