/**
 * SsoConnectionsController: staff management of enterprise SSO connections
 * (3.4.1, 3.4.4, 5.4).
 *
 * GET   /ops/sso-connections?orgId=                       list with domains
 * POST  /ops/sso-connections                              create (DRAFT)
 * PATCH /ops/sso-connections/:id                          metadata and status changes
 * POST  /ops/sso-connections/:id/domains                  add a domain, returns the TXT record
 * POST  /ops/sso-connections/:id/domains/:domainId/verify DNS TXT verification
 * POST  /ops/sso-connections/:id/test                     register the provider, TESTING, test start URL
 * POST  /ops/sso-connections/:id/activate                 TESTING -> ACTIVE
 *
 * Every route needs `sso.manage` (an administration step-up action, which
 * the authorization guard enforces) in the operations context; writes are
 * throttled to 10 per minute per route.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  ACTIONS,
  SsoConnectionCreateRequestSchema,
  SsoConnectionDomainRequestSchema,
  SsoConnectionUpdateRequestSchema,
  type Principal,
  type SsoConnectionCreateRequest,
  type SsoConnectionDomainRequest,
  type SsoConnectionListResponse,
  type SsoConnectionResponse,
  type SsoConnectionUpdateRequest,
  type SsoDomainResponse,
  type SsoTestResponse,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsResource } from '../authz/resolvers.js';
import { WRITE_THROTTLE } from '../authz/throttles.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SsoConnectionsService, idpInitiatedRefused } from './sso-connections.service.js';

export const SsoConnectionListQuerySchema = z.object({ orgId: z.string().min(1).optional() });
export type SsoConnectionListQuery = z.infer<typeof SsoConnectionListQuerySchema>;

/**
 * Body validation that answers `idpInitiatedAllowed: true` with 422
 * `validation` (a refused policy, not a malformed request); everything else
 * goes through the usual 400 `validation`.
 */
class SsoBodyPipe extends ZodValidationPipe {
  override transform(value: unknown) {
    if (typeof value === 'object' && value !== null && (value as Record<string, unknown>)['idpInitiatedAllowed'] === true) {
      throw idpInitiatedRefused();
    }
    return super.transform(value);
  }
}

const routeParam =
  (name: string) =>
  (req: Record<string, unknown>): string | undefined =>
    (req['params'] as Record<string, string | undefined> | undefined)?.[name];
const routeId = routeParam('id');

const SSO_MANAGE = ACTIONS['sso.manage'];

@Controller('ops/sso-connections')
export class SsoConnectionsController {
  constructor(private readonly sso: SsoConnectionsService) {}

  @Get()
  @Authorize(SSO_MANAGE, operationsResource('sso_connection'))
  async list(
    @Query(new ZodValidationPipe(SsoConnectionListQuerySchema)) query: SsoConnectionListQuery,
  ): Promise<SsoConnectionListResponse> {
    return this.sso.list(query);
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @Authorize(SSO_MANAGE, operationsResource('sso_connection'))
  async create(
    @Body(new SsoBodyPipe(SsoConnectionCreateRequestSchema)) body: SsoConnectionCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SsoConnectionResponse> {
    return this.sso.create(body, principal);
  }

  @Patch(':id')
  @Throttle(WRITE_THROTTLE)
  @Authorize(SSO_MANAGE, operationsResource('sso_connection', routeId))
  async update(
    @Param('id') id: string,
    @Body(new SsoBodyPipe(SsoConnectionUpdateRequestSchema)) body: SsoConnectionUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SsoConnectionResponse> {
    return this.sso.update(id, body, principal);
  }

  @Post(':id/domains')
  @Throttle(WRITE_THROTTLE)
  @Authorize(SSO_MANAGE, operationsResource('sso_connection', routeId))
  async addDomain(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SsoConnectionDomainRequestSchema)) body: SsoConnectionDomainRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SsoDomainResponse> {
    return this.sso.addDomain(id, body.domain, principal);
  }

  @Post(':id/domains/:domainId/verify')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(SSO_MANAGE, operationsResource('sso_connection', routeId))
  async verifyDomain(
    @Param('id') id: string,
    @Param('domainId') domainId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<SsoDomainResponse> {
    return this.sso.verifyDomain(id, domainId, principal);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(SSO_MANAGE, operationsResource('sso_connection', routeId))
  async test(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<SsoTestResponse> {
    return this.sso.test(id, principal);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(SSO_MANAGE, operationsResource('sso_connection', routeId))
  async activate(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<SsoConnectionResponse> {
    return this.sso.activate(id, principal);
  }
}
