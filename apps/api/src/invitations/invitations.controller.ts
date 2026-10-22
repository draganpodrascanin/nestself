/**
 * Org-scoped invitation routes: create, import, revoke.
 *
 * All routes under `/orgs/:orgId/invitations`. Require authorization via
 * `@Authorize()` with the appropriate action.
 *
 * @see T-1.5, API-R-21, 5.3
 */
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ACTIONS } from '@nestself/contracts';
import type { Principal } from '@nestself/contracts';
import {
  InvitationCreateRequestSchema,
  InvitationImportRequestSchema,
} from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { orgResourceFromContext } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { InvitationsService } from './invitations.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Validation helper (same pattern as auth.controller.ts)
// ---------------------------------------------------------------------------

function validate<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err: unknown) {
    const message =
      err && typeof err === 'object' && 'issues' in err
        ? JSON.stringify((err as { issues: unknown }).issues)
        : 'Validation failed';
    throw new ApiHttpException({
      status: 400,
      code: 'validation',
      message,
    });
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('orgs/:orgId/invitations')
export class InvitationsController {
  private readonly isProduction: boolean;

  constructor(
    private readonly invitations: InvitationsService,
    config: ConfigService,
  ) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  // -----------------------------------------------------------------------
  // POST /orgs/:orgId/invitations
  // -----------------------------------------------------------------------

  @Authorize(ACTIONS['people.invite'], orgResourceFromContext('invitation'))
  @Post()
  @HttpCode(201)
  async create(
    @Param('orgId') orgId: string,
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ) {
    const parsed = validate(InvitationCreateRequestSchema, body);
    return this.invitations.create(orgId, parsed, principal.userId, this.isProduction);
  }

  // -----------------------------------------------------------------------
  // POST /orgs/:orgId/invitations/import
  // -----------------------------------------------------------------------

  @Authorize(ACTIONS['people.import'], orgResourceFromContext('invitation'))
  @Post('import')
  @HttpCode(200)
  async importInvitations(
    @Param('orgId') orgId: string,
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ) {
    const parsed = validate(InvitationImportRequestSchema, body);
    return this.invitations.import(orgId, parsed, principal.userId, this.isProduction);
  }

  // -----------------------------------------------------------------------
  // DELETE /orgs/:orgId/invitations/:invitationId
  // -----------------------------------------------------------------------

  @Authorize(ACTIONS['people.invite'], orgResourceFromContext('invitation'))
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
