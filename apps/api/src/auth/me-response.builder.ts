/**
 * Builds the `MeResponse` every sign-in, session and profile endpoint
 * returns: the principal plus the actions the decision engine allows in the
 * principal's active context (CLIENT-R-06, AUTHZ-R-42).
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { AuthorizationService } from '../authz/authorization.service.js';
import type { MeResponse, Principal } from '@nestself/contracts';

@Injectable()
export class MeResponseBuilder {
  constructor(
    @Inject(forwardRef(() => AuthorizationService)) private readonly authz: AuthorizationService,
  ) {}

  async build(principal: Principal): Promise<MeResponse> {
    const effectiveActions = await this.authz.effectiveActions(principal);
    return { principal, effectiveActions };
  }
}
