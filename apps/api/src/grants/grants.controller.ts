/**
 * GrantsController — organization grant administration (T-2.1).
 *
 * GET   /orgs/:orgId/grants                   — list (access.preview)
 * POST  /orgs/:orgId/grants                   — create from a template (access.grant)
 * PATCH /orgs/:orgId/grants/:grantId          — adjust conditions/validity (access.grant)
 * POST  /orgs/:orgId/grants/:grantId/revoke   — revoke with descendants (access.revoke)
 * POST  /orgs/:orgId/grants/delegate          — delegate from an own grant (access.delegate)
 * GET   /orgs/:orgId/grants/preview?userId=   — effective access preview (access.preview)
 *
 * Writes are throttled to 10 per minute per route.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  ACTIONS,
  GrantCreateRequestSchema,
  GrantDelegateRequestSchema,
  GrantPreviewQuerySchema,
  GrantRevokeRequestSchema,
  GrantUpdateRequestSchema,
  type GrantCreateRequest,
  type GrantDelegateRequest,
  type GrantListResponse,
  type GrantPreviewQuery,
  type GrantPreviewResponse,
  type GrantResponse,
  type GrantRevokeRequest,
  type GrantUpdateRequest,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { GrantsService } from './grants.service.js';

/** Writes are throttled to 10 per minute per route; shared by the grant controllers. */
export const WRITE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

export const GrantListQuerySchema = z.object({
  subjectUserId: z.string().min(1).optional(),
  includeRevoked: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type GrantListQuery = z.infer<typeof GrantListQuerySchema>;

@Controller('orgs/:orgId/grants')
export class GrantsController {
  constructor(private readonly grants: GrantsService) {}

  @Get()
  @Authorize(ACTIONS['access.preview'], orgResourceFromContext('grant'))
  async list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(GrantListQuerySchema)) query: GrantListQuery,
  ): Promise<GrantListResponse> {
    return this.grants.list(orgId, query);
  }

  @Get('preview')
  @Authorize(ACTIONS['access.preview'], orgResourceFromContext('grant'))
  async preview(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(GrantPreviewQuerySchema)) query: GrantPreviewQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantPreviewResponse> {
    return this.grants.preview(orgId, query.userId, principal);
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.grant'], orgResourceFromContext('grant'))
  async create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(GrantCreateRequestSchema)) body: GrantCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantResponse> {
    return this.grants.create(orgId, body, principal);
  }

  @Post('delegate')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.delegate'], orgResourceFromContext('grant'))
  async delegate(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(GrantDelegateRequestSchema)) body: GrantDelegateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantResponse> {
    return this.grants.delegate(orgId, body, principal);
  }

  @Patch(':grantId')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.grant'], orgResourceFromContext('grant'))
  async update(
    @Param('orgId') orgId: string,
    @Param('grantId') grantId: string,
    @Body(new ZodValidationPipe(GrantUpdateRequestSchema)) body: GrantUpdateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantResponse> {
    return this.grants.update(orgId, grantId, body, principal);
  }

  @Post(':grantId/revoke')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.revoke'], orgResourceFromContext('grant'))
  async revoke(
    @Param('orgId') orgId: string,
    @Param('grantId') grantId: string,
    @Body(new ZodValidationPipe(GrantRevokeRequestSchema)) body: GrantRevokeRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantResponse> {
    return this.grants.revoke(orgId, grantId, body, principal);
  }
}
