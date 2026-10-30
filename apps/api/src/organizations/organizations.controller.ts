/**
 * OrganizationsController: employer clients as seen from the operations
 * workspace (auth UI completeness plan, 2026-10-25).
 *
 * GET /ops/organizations          list with search and cursor (client.configure)
 * GET /ops/organizations/:orgId   one organization (client.configure)
 *
 * Both routes require a web session in the operations context (API-R-28).
 * The list is a platform-level resource, so only a platform-scoped grant
 * (`platform_owner`) reaches it; the detail route names the organization,
 * so an `assigned_clients` grant (`client_operations`) reaches the clients
 * the caller holds a CLIENT assignment for.
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ACTIONS,
  OrganizationListQuerySchema,
  type OrganizationListQuery,
  type OrganizationListResponse,
  type OrganizationResponse,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsOrgResource, operationsResource } from '../authz/resolvers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsService } from './organizations.service.js';

@Controller('ops/organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @Authorize(ACTIONS['client.configure'], operationsResource('organization'))
  list(
    @Query(new ZodValidationPipe(OrganizationListQuerySchema)) query: OrganizationListQuery,
  ): Promise<OrganizationListResponse> {
    return this.organizations.list(query);
  }

  @Get(':orgId')
  @Authorize(ACTIONS['client.configure'], operationsOrgResource('organization'))
  get(@Param('orgId') orgId: string): Promise<OrganizationResponse> {
    return this.organizations.get(orgId);
  }
}
