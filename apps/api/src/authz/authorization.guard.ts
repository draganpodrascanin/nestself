/**
 * Global AuthorizationGuard -- evaluates @Authorize() metadata.
 *
 * Routes without @Authorize() or @Public() are handled by the default-deny test.
 *
 * @see 4.6.1, D-19, AUTHZ-R-49, AUTHZ-R-61, T-1.6
 */
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
 
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { IS_AUTHENTICATED_ONLY_KEY } from './authenticated.decorator.js';
import {
  AUTHORIZE_KEY,
  type AuthorizeMetadata,
} from './authorize.decorator.js';
 
import { ContextLoader } from './context-loader.js';
 
import { AuditWriter } from '../audit/audit-writer.js';
import { authorize } from './authorize.js';
import { ApiHttpException } from '../common/api-error.js';
import type { Action, Decision, Principal, Resource } from '@nestself/contracts';
import { STEP_UP_CLASS_BY_ACTION } from '@nestself/contracts';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { assertStepUpFresh } from './step-up-freshness.js';

interface HttpReq {
  principal?: Principal;
  params?: Record<string, string>;
  stepUpClass?: string;
  [key: string]: unknown;
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  private readonly logger = new Logger(AuthorizationGuard.name);

  constructor(
    @Inject(forwardRef(() => Reflector)) private readonly reflector: Reflector,
    @Inject(forwardRef(() => ContextLoader)) private readonly contextLoader: ContextLoader,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Skip @Authenticated() routes — principal present, no action check
    const isAuthOnly = this.reflector.getAllAndOverride<boolean>(
      IS_AUTHENTICATED_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isAuthOnly) return true;

    // A handler without any security decorator is a programming error that
    // the default-deny CI test catches; deny at runtime as well (AUTHZ-R-49).
    const meta = this.reflector.getAllAndOverride<
      AuthorizeMetadata | undefined
    >(AUTHORIZE_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} has no @Public, @Authenticated or @Authorize decorator`,
      );
      throw new ApiHttpException({
        status: 403,
        code: 'forbidden',
        message: 'Access denied',
      });
    }

    const req = context.switchToHttp().getRequest<HttpReq>();
    const principal = req.principal;
    if (!principal) {
      throw new ApiHttpException({
        status: 401,
        code: 'unauthenticated',
        message: 'Not authenticated',
      });
    }

    // Resolve the resource
    const resource = await meta.resolver(req, principal);

    // Build context and authorize. The route lists the actions that may open
    // it: any one is enough, so they are evaluated in order and the first that
    // allows decides. When none does, the first denial is the one reported.
    let allowedBy: Action | undefined;
    let firstDenial: Decision | undefined;
    for (const action of meta.actions) {
      const ctx = await this.contextLoader.build(principal, resource, { action });
      const decision = authorize(principal, action, resource, ctx);
      if (decision.allowed) {
        allowedBy = action;
        break;
      }
      firstDenial ??= decision;
    }

    if (allowedBy === undefined) {
      // Non-disclosure: 404 when no visibility into the org (AUTHZ-R-61)
      const hasVisibility = this.hasOrgVisibility(principal, resource);

      await this.audit.record({
        action: 'access.denied',
        actorUserId: principal.userId,
        actorKind: 'USER',
        orgId: resource.orgId ?? null,
        recordType: resource.type,
        recordId: resource.id ?? 'unknown',
        result: 'DENIED',
        details: {
          actionAttempted: meta.actions[0],
          // Only a route with alternatives names them; a single action keeps its audit row as it was.
          ...(meta.actions.length > 1 ? { alternatives: meta.actions } : {}),
          resourceType: resource.type,
          resourceId: resource.id,
          reason: firstDenial?.denialReason,
        },
      });

      if (!hasVisibility) {
        throw new ApiHttpException({
          status: 404,
          code: 'not_found',
          message: 'Resource not found',
        });
      }

      throw new ApiHttpException({
        status: 403,
        code: 'forbidden',
        message: 'Access denied',
      });
    }

    // Annotate the step-up class of the action that allowed the request and
    // enforce its freshness.
    const stepUpClass = STEP_UP_CLASS_BY_ACTION[allowedBy];
    if (stepUpClass) {
      req.stepUpClass = stepUpClass;
    }
    await assertStepUpFresh(principal, allowedBy, this.store);

    return true;
  }

  private hasOrgVisibility(principal: Principal, resource: Resource): boolean {
    if (!resource.orgId) return true;
    const hasMembership = principal.memberships.some(
      (m) => m.orgId === resource.orgId && m.status === 'ACTIVE',
    );
    if (hasMembership) return true;
    if (principal.staffTemplates.length > 0) return true;
    return false;
  }
}
