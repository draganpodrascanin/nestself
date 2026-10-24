/**
 * Builds the `MeResponse` every sign-in, session and profile endpoint
 * returns: the principal, the actions the decision engine allows in the
 * principal's active context, and the available context entries
 * (CLIENT-R-06, AUTHZ-R-42, T-C1.02).
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { AuthorizationService } from '../authz/authorization.service.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import { computeAvailableContexts } from '../authz/personal-context.js';
import type { MeResponse, Principal } from '@nestself/contracts';

@Injectable()
export class MeResponseBuilder {
  constructor(
    @Inject(forwardRef(() => AuthorizationService)) private readonly authz: AuthorizationService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
  ) {}

  async build(principal: Principal): Promise<MeResponse> {
    const loaded = await this.principalLoader.load(principal.userId);
    const [effectiveActions, extras] = await Promise.all([
      this.authz.effectiveActions(principal),
      loaded ? this.principalLoader.loadAvailableContextExtras(loaded) : Promise.resolve({ orgNames: new Map(), orgGrantTemplateKeys: new Map() }),
    ]);
    const availableContexts = loaded
      ? computeAvailableContexts(loaded, extras)
      : [];
    return { principal, effectiveActions, availableContexts };
  }
}
