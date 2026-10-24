/**
 * ApprovalAuthoritiesController — approval authorities of an organization
 * (T-2.1, D-17, MGR-04).
 *
 * GET   /orgs/:orgId/approval-authorities       — list (access.preview)
 * POST  /orgs/:orgId/approval-authorities       — create (access.grant)
 * PATCH /orgs/:orgId/approval-authorities/:id   — adjust (access.grant)
 *
 * Writes are throttled to 10 per minute per route.
 */
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  ApprovalAuthorityCreateRequestSchema,
  ApprovalAuthorityUpdateRequestSchema,
  type ApprovalAuthorityCreateRequest,
  type ApprovalAuthorityResponse,
  type ApprovalAuthorityUpdateRequest,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ApprovalAuthoritiesService } from './approval-authorities.service.js';
import type { ApprovalAuthorityListResponse } from './approval-authorities.service.js';
import { WRITE_THROTTLE } from './grants.controller.js';

@Controller('orgs/:orgId/approval-authorities')
export class ApprovalAuthoritiesController {
  constructor(private readonly authorities: ApprovalAuthoritiesService) {}

  @Get()
  @Authorize(ACTIONS['access.preview'], orgResourceFromContext('approval_authority'))
  async list(@Param('orgId') orgId: string): Promise<ApprovalAuthorityListResponse> {
    return this.authorities.list(orgId);
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.grant'], orgResourceFromContext('approval_authority'))
  async create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(ApprovalAuthorityCreateRequestSchema)) body: ApprovalAuthorityCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ApprovalAuthorityResponse> {
    return this.authorities.create(orgId, body, principal);
  }

  @Patch(':id')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.grant'], orgResourceFromContext('approval_authority'))
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApprovalAuthorityUpdateRequestSchema)) body: ApprovalAuthorityUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ApprovalAuthorityResponse> {
    return this.authorities.update(orgId, id, body, principal);
  }
}
