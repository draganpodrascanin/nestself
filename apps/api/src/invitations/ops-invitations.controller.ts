/**
 * OpsInvitationsController — invitations for assigned clients, reached from
 * the operations workspace (T-2.0).
 *
 * POST   /ops/orgs/:orgId/invitations                — create (people.onboard)
 * POST   /ops/orgs/:orgId/invitations/import         — import (people.import)
 * DELETE /ops/orgs/:orgId/invitations/:invitationId  — revoke (people.onboard)
 *
 * `client_operations` holds `people.onboard` rather than `people.invite`
 * (strategy 4.4, golden case OPS-05), so create and revoke are guarded by it.
 */
import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import {
  ACTIONS,
  InvitationCreateRequestSchema,
  InvitationImportRequestSchema,
  type InvitationCreateRequest,
  type InvitationImportRequest,
  type Principal,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { operationsOrgResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { InvitationsService } from './invitations.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';

@Controller('ops/orgs/:orgId/invitations')
export class OpsInvitationsController {
  private readonly isProduction: boolean;

  constructor(
    private readonly invitations: InvitationsService,
    config: ConfigService,
  ) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  @Authorize(ACTIONS['people.onboard'], operationsOrgResource('invitation'))
  @Post()
  @HttpCode(201)
  async create(
    @Param('orgId') orgId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(InvitationCreateRequestSchema)) body: InvitationCreateRequest,
  ) {
    return this.invitations.create(orgId, body, principal.userId, this.isProduction);
  }

  @Authorize(ACTIONS['people.import'], operationsOrgResource('invitation'))
  @Post('import')
  @HttpCode(200)
  async importInvitations(
    @Param('orgId') orgId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(InvitationImportRequestSchema)) body: InvitationImportRequest,
  ) {
    return this.invitations.import(orgId, body, principal.userId, this.isProduction);
  }

  @Authorize(ACTIONS['people.onboard'], operationsOrgResource('invitation'))
  @Delete(':invitationId')
  @HttpCode(200)
  async revoke(
    @Param('orgId') orgId: string,
    @Param('invitationId') invitationId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.invitations.revoke(orgId, invitationId, principal.userId);
  }
}
