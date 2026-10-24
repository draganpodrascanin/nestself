/**
 * OpsGrantsController — grant administration from the operations workspace
 * (T-2.1).
 *
 * GET  /ops/grants                                 — platform grants (access.preview)
 * POST /ops/grants                                 — platform grant from an operations template (access.grant)
 * GET  /ops/orgs/:orgId/grants                     — organization grants (access.preview)
 * POST /ops/orgs/:orgId/grants                     — organization grant from a template (access.grant)
 * POST /ops/orgs/:orgId/grants/:grantId/revoke     — revoke with descendants (access.revoke)
 * GET  /ops/orgs/:orgId/grants/preview?userId=     — effective access preview (access.preview)
 * GET  /ops/users/:userId/access                   — effective access per context (access.preview)
 *
 * Every route requires a web session in the operations context (API-R-28).
 * `/ops/orgs/:orgId/*` routes reuse the organization grant service; the
 * `assigned_clients` scope applies through the caller's CLIENT assignment.
 * Writes are throttled to 10 per minute per route.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ACTIONS,
  GrantCreateRequestSchema,
  GrantPreviewQuerySchema,
  GrantRevokeRequestSchema,
  PlatformGrantCreateRequestSchema,
  type GrantCreateRequest,
  type GrantListResponse,
  type GrantPreviewQuery,
  type GrantPreviewResponse,
  type GrantResponse,
  type GrantRevokeRequest,
  type PlatformGrantCreateRequest,
  type Principal,
  type UserAccessResponse,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsOrgResource, operationsResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { GrantsService } from './grants.service.js';
import { GrantListQuerySchema, WRITE_THROTTLE, type GrantListQuery } from './grants.controller.js';

const routeUserId = (req: Record<string, unknown>): string | undefined =>
  (req['params'] as Record<string, string | undefined> | undefined)?.['userId'];

@Controller('ops')
export class OpsGrantsController {
  constructor(private readonly grants: GrantsService) {}

  // ── Platform grants ───────────────────────────────────────────────────

  @Get('grants')
  @Authorize(ACTIONS['access.preview'], operationsResource('grant'))
  async listPlatform(
    @Query(new ZodValidationPipe(GrantListQuerySchema)) query: GrantListQuery,
  ): Promise<GrantListResponse> {
    return this.grants.listPlatform(query);
  }

  @Post('grants')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.grant'], operationsResource('grant'))
  async createPlatform(
    @Body(new ZodValidationPipe(PlatformGrantCreateRequestSchema)) body: PlatformGrantCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantResponse> {
    return this.grants.createPlatform(body, principal);
  }

  // ── Organization grants ───────────────────────────────────────────────

  @Get('orgs/:orgId/grants')
  @Authorize(ACTIONS['access.preview'], operationsOrgResource('grant'))
  async listOrg(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(GrantListQuerySchema)) query: GrantListQuery,
  ): Promise<GrantListResponse> {
    return this.grants.list(orgId, query);
  }

  @Get('orgs/:orgId/grants/preview')
  @Authorize(ACTIONS['access.preview'], operationsOrgResource('grant'))
  async previewOrg(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(GrantPreviewQuerySchema)) query: GrantPreviewQuery,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantPreviewResponse> {
    return this.grants.preview(orgId, query.userId, principal);
  }

  @Post('orgs/:orgId/grants')
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.grant'], operationsOrgResource('grant'))
  async createOrg(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(GrantCreateRequestSchema)) body: GrantCreateRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantResponse> {
    return this.grants.create(orgId, body, principal);
  }

  @Post('orgs/:orgId/grants/:grantId/revoke')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @Authorize(ACTIONS['access.revoke'], operationsOrgResource('grant'))
  async revokeOrg(
    @Param('orgId') orgId: string,
    @Param('grantId') grantId: string,
    @Body(new ZodValidationPipe(GrantRevokeRequestSchema)) body: GrantRevokeRequest,
    @CurrentPrincipal() principal: Principal,
  ): Promise<GrantResponse> {
    return this.grants.revoke(orgId, grantId, body, principal);
  }

  // ── Users ─────────────────────────────────────────────────────────────

  @Get('users/:userId/access')
  @Authorize(ACTIONS['access.preview'], operationsResource('user', routeUserId))
  async userAccess(@Param('userId') userId: string): Promise<UserAccessResponse> {
    return this.grants.userAccess(userId);
  }
}
