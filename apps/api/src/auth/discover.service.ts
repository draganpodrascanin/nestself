/**
 * DiscoverService -- home-realm discovery (3.4.3): picks the sign-in method
 * for an email address.
 *
 * 1. normalise the address and take its domain;
 * 2. a public email domain (`PUBLIC_EMAIL_DOMAINS`) never routes to SSO;
 * 3-4. a verified domain of an ACTIVE connection answers `sso` with the
 *    absolute start URL and the connection's `cognitoProviderName`;
 * 6. otherwise the native method: `password` for a user with a password,
 *    `email_otp` for everyone else, unknown addresses included.
 *
 * Known, unknown and SSO-routed addresses take the same time and get the
 * same shape and status (SESS-R-21, SSO-R-04, API-R-01): every answer waits
 * for `neutralDelay`. An identity-provider or connection-lookup failure is
 * not revealed either: it is logged and answered with the neutral
 * `email_otp` shape. Only throttling (`too_many_attempts`, caused by the
 * caller's request rate) surfaces, as 429.
 *
 * @see T-1.4, API-R-01, SSO-R-04, SSO-R-05
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  IdentityProviderError,
  IdentityProviderService,
  type IdpUser,
} from '../identity/identity-provider.service.js';
import { SsoRepository, type SsoConnectionRow } from '../db/repositories/sso.repository.js';
import { IdentityResolutionService } from './identity-resolution.service.js';
import { isPublicEmailDomain } from './constants.js';
import { neutralDelay } from './neutral-delay.js';
import { apiPublicUrlFrom, buildSsoStartUrl } from './sso-start-url.js';
import type { DiscoverResponse } from '@nestself/contracts';

const NEUTRAL: DiscoverResponse = { method: 'email_otp', ssoStartUrl: null, connection: null };

@Injectable()
export class DiscoverService {
  private readonly logger = new Logger(DiscoverService.name);

  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => IdentityResolutionService)) private readonly identity: IdentityResolutionService,
    @Inject(forwardRef(() => SsoRepository)) private readonly sso: SsoRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async discover(email: string, surface: 'workspace' | 'admin' = 'workspace'): Promise<DiscoverResponse> {
    const start = Date.now();
    const normalised = email.trim().toLowerCase();
    const domain = normalised.slice(normalised.lastIndexOf('@') + 1);

    const connection = await this.findConnection(domain);
    if (connection) {
      await neutralDelay(start);
      return {
        method: 'sso',
        ssoStartUrl: buildSsoStartUrl(apiPublicUrlFrom(this.config.get<string>('API_PUBLIC_URL')), {
          connection: connection.cognitoProviderName,
          surface,
        }),
        connection: connection.cognitoProviderName,
      };
    }

    let user: IdpUser | null = null;
    try {
      user = await this.idp.findUserByEmail(normalised);
    } catch (err) {
      if (!(err instanceof IdentityProviderError)) throw err;
      await neutralDelay(start);
      if (err.code === 'too_many_attempts') throw this.identity.mapIdpError(err);
      this.logger.warn(`Identity provider lookup failed during discover (${err.code}); answering neutrally`);
      return NEUTRAL;
    }
    await neutralDelay(start);
    if (user?.hasPassword) {
      return { method: 'password', ssoStartUrl: null, connection: null };
    }
    return NEUTRAL;
  }

  /** Steps 2-4: blocklist, verified domain, ACTIVE connection. Null on any lookup failure. */
  private async findConnection(domain: string): Promise<SsoConnectionRow | null> {
    if (!domain || isPublicEmailDomain(domain)) return null;
    try {
      return await this.sso.findActiveConnectionForDomain(domain);
    } catch (err) {
      this.logger.warn(`SSO connection lookup failed during discover (${(err as Error).name}); answering natively`);
      return null;
    }
  }
}
