/**
 * OrgUnitsController — organization tree administration (5.3).
 *
 * GET  /orgs/:orgId/org-units         — list (program.overview or access.preview)
 * POST /orgs/:orgId/org-units         — create (org_units.manage)
 * PATCH /orgs/:orgId/org-units/:unitId — update (org_units.manage)
 * POST /orgs/:orgId/org-units/:unitId/move — move (org_units.manage)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ACTIONS,
  OrgUnitCreateRequestSchema,
  OrgUnitMoveRequestSchema,
  OrgUnitUpdateRequestSchema,
  type OrgUnitCreateRequest,
  type OrgUnitMoveRequest,
  type OrgUnitResponse,
  type OrgUnitUpdateRequest,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrgUnitsService } from './org-units.service.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import type { Principal } from '@nestself/contracts';

@Controller('orgs/:orgId/org-units')
export class OrgUnitsController {
  constructor(private readonly orgUnitsService: OrgUnitsService) {}

  @Get()
  @Authorize(
    [ACTIONS['program.overview'], ACTIONS['access.preview']],
    orgResourceFromContext('org_unit'),
  )
  async list(
    @Param('orgId') orgId: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<{ items: OrgUnitResponse[] }> {
    const include = includeArchived === 'true';
    return this.orgUnitsService.listUnits(orgId, include);
  }

  @Post()
  @Authorize(ACTIONS['org_units.manage'], orgResourceFromContext('org_unit'))
  async create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(OrgUnitCreateRequestSchema)) body: OrgUnitCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OrgUnitResponse> {
    return this.orgUnitsService.createUnit(orgId, body, principal.userId);
  }

  @Patch(':unitId')
  @Authorize(ACTIONS['org_units.manage'], orgResourceFromContext('org_unit'))
  async update(
    @Param('orgId') orgId: string,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(OrgUnitUpdateRequestSchema)) body: OrgUnitUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OrgUnitResponse> {
    return this.orgUnitsService.updateUnit(orgId, unitId, body, principal.userId);
  }

  @Post(':unitId/move')
  @HttpCode(200)
  @Authorize(ACTIONS['org_units.manage'], orgResourceFromContext('org_unit'))
  async move(
    @Param('orgId') orgId: string,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(OrgUnitMoveRequestSchema)) body: OrgUnitMoveRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<OrgUnitResponse> {
    return this.orgUnitsService.moveUnit(orgId, unitId, body, principal.userId);
  }
}
