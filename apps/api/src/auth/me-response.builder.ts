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
import type { MeResponse, Principal, AvailableContextEntry } from '@nestself/contracts';

@Injectable()
export class MeResponseBuilder {
  constructor(
    @Inject(forwardRef(() => AuthorizationService)) private readonly authz: AuthorizationService,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principalLoader: PrincipalLoader,
  ) {}

  /**
   * Build a MeResponse.  When `opts.availableContexts` is supplied (e.g. from
   * `switchContext` which already computed them for validation), the builder
   * reuses them instead of loading again (C1, I3).
   */
  async build(
    principal: Principal,
    opts?: { availableContexts?: AvailableContextEntry[] },
  ): Promise<MeResponse> {
    const loaded = await this.principalLoader.load(principal.userId);
    const effectiveActionsP = this.authz.effectiveActions(principal);

    let availableContexts: AvailableContextEntry[];
    if (opts?.availableContexts) {
      availableContexts = opts.availableContexts;
    } else {
      const extras = loaded
        ? await this.principalLoader.loadAvailableContextExtras(loaded)
        : { orgNames: new Map(), orgGrantTemplateKeys: new Map() };
      availableContexts = loaded ? computeAvailableContexts(loaded, extras) : [];
    }

    const effectiveActions = await effectiveActionsP;
    return { principal, effectiveActions, availableContexts };
  }
}
