/**
 * DiscoverService -- determines the sign-in method for a given email.
 *
 * Known and unknown addresses take the same time and get the same shape
 * (SESS-R-21, API-R-01). An identity-provider failure is not revealed
 * either: it is logged and answered with the neutral `email_otp` shape after
 * the same delay. Only throttling (`too_many_attempts`, caused by the
 * caller's request rate) surfaces, as 429.
 *
 * @see T-1.4, API-R-01
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import {
  IdentityProviderError,
  IdentityProviderService,
  type IdpUser,
} from '../identity/identity-provider.service.js';
import { IdentityResolutionService } from './identity-resolution.service.js';
import { neutralDelay } from './neutral-delay.js';
import type { DiscoverResponse } from '@nestself/contracts';

@Injectable()
export class DiscoverService {
  private readonly logger = new Logger(DiscoverService.name);

  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identity: IdentityResolutionService,
  ) {}

  async discover(email: string): Promise<DiscoverResponse> {
    const start = Date.now();
    let user: IdpUser | null = null;
    try {
      user = await this.idp.findUserByEmail(email);
    } catch (err) {
      if (!(err instanceof IdentityProviderError)) throw err;
      await neutralDelay(start);
      if (err.code === 'too_many_attempts') throw this.identity.mapIdpError(err);
      this.logger.warn(`Identity provider lookup failed during discover (${err.code}); answering neutrally`);
      return { method: 'email_otp', ssoStartUrl: null, connection: null };
    }
    await neutralDelay(start);
    if (user?.hasPassword) {
      return { method: 'password', ssoStartUrl: null, connection: null };
    }
    return { method: 'email_otp', ssoStartUrl: null, connection: null };
  }
}
